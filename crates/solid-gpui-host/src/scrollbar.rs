//! The scrollbar gpui does not ship.
//!
//! gpui gives an element a scroll offset and a maximum, and leaves drawing the
//! bar to the application — Zed builds its own. This is that, driven from the
//! same handles the renderer already keeps: a `<div>` with `overflow: "scroll"`
//! owns a `ScrollHandle`, a `<uniform-list>` a `UniformListScrollHandle`, and a
//! `<list>` a `ListState`.
//!
//! It wraps what it scrolls rather than naming it: the bar has to be a sibling
//! of the scrolling content — inside it, it would scroll away — and wrapping is
//! the arrangement where the thing being scrolled is guaranteed to exist by the
//! time the bar is built.
//!
//! Dragging is handled from `paint` rather than with element listeners, because
//! a listener on the bar stops hearing the mouse the moment it leaves — and a
//! pointer wandering off an eight-pixel-wide track while dragging is the normal
//! case, not the exception.

use std::cell::Cell;
use std::rc::Rc;

use gpui::{
    App, Bounds, DispatchPhase, Element, ElementId, GlobalElementId, Hitbox, HitboxBehavior,
    InspectorElementId, IntoElement, LayoutId, MouseDownEvent, MouseMoveEvent, MouseUpEvent,
    Pixels, Style, Window, fill, hsla, point, px, relative, size,
};

use crate::protocol::NodeId;
use crate::render::Shared;
use crate::style::WireStyle;

/// Where the thumb sits, as fractions of the track.
#[derive(Debug, Clone, Copy)]
pub struct Metrics {
    /// How much of the content is on screen, from 0 to 1.
    pub extent: f32,
    /// How far through the scrollable range the viewport is, from 0 to 1.
    pub progress: f32,
}

/// The scrollable state a `<scrollbar>` can be pointed at.
enum Target {
    /// An element with `overflow: "scroll"`.
    Offsets(gpui::ScrollHandle),
    /// A list of equal-height rows, which scrolls by pixels like the above.
    Rows(gpui::UniformListScrollHandle),
    /// A list of differing heights, which only knows where it is by item: it
    /// caches heights as it measures them and never totals them up.
    Items(gpui::ListState, usize, usize),
}

fn target(tree: &Shared, id: NodeId) -> Option<Target> {
    let borrowed = tree.borrow();
    let node = borrowed.get(id)?;
    if let Some(handle) = node.scroll.as_ref() {
        return Some(Target::Offsets(handle.clone()));
    }
    if let Some(handle) = node.list_scroll.as_ref() {
        return Some(Target::Rows(handle.clone()));
    }
    let state = node.list.borrow().clone()?;
    let count = node.prop_usize("count").unwrap_or(0);
    let visible = node
        .last_range
        .get()
        .map(|(start, end)| end.saturating_sub(start))
        .unwrap_or(1);
    Some(Target::Items(state, count, visible))
}

/// The thumb for a viewport of `viewport` pixels that can travel `max` more,
/// currently `offset` pixels along.
pub fn geometry(viewport: f32, max: f32, offset: f32) -> Metrics {
    let max = max.max(0.);
    let content = viewport + max;
    Metrics {
        extent: if content > 0. {
            (viewport / content).clamp(0., 1.)
        } else {
            1.
        },
        progress: if max > 0. { (offset / max).clamp(0., 1.) } else { 0. },
    }
}

fn from_offsets(handle: &gpui::ScrollHandle, vertical: bool) -> Metrics {
    let viewport = handle.bounds().size;
    // gpui keeps the offset negative — scrolling down moves the content up —
    // while the maximum is the positive distance the content can travel.
    match vertical {
        true => geometry(
            f32::from(viewport.height),
            f32::from(handle.max_offset().y),
            f32::from(-handle.offset().y),
        ),
        false => geometry(
            f32::from(viewport.width),
            f32::from(handle.max_offset().x),
            f32::from(-handle.offset().x),
        ),
    }
}

/// Where in the track a thumb of `thumb` pixels sits, and how far the pointer
/// can move it.
pub fn travel(track: f32, extent: f32, minimum: f32) -> (f32, f32) {
    let thumb = (track * extent).max(minimum).min(track);
    (thumb, track - thumb)
}

impl Target {
    fn metrics(&self, vertical: bool) -> Metrics {
        match self {
            Target::Offsets(handle) => from_offsets(handle, vertical),
            Target::Rows(handle) => from_offsets(&handle.0.borrow().base_handle, vertical),
            Target::Items(state, count, visible) => {
                let count = *count as f32;
                let visible = (*visible).max(1) as f32;
                let top = state.logical_scroll_top().item_ix as f32;
                let scrollable = (count - visible).max(1.);
                Metrics {
                    extent: if count > 0. {
                        (visible / count).clamp(0., 1.)
                    } else {
                        1.
                    },
                    progress: (top / scrollable).clamp(0., 1.),
                }
            }
        }
    }

    /// Scrolls to a fraction of the scrollable range.
    fn scroll_to(&self, progress: f32, vertical: bool) {
        let progress = progress.clamp(0., 1.);
        match self {
            Target::Offsets(handle) => set_offset(handle, progress, vertical),
            Target::Rows(handle) => {
                let base = handle.0.borrow().base_handle.clone();
                set_offset(&base, progress, vertical);
            }
            Target::Items(state, count, visible) => {
                // A list of differing heights has no pixel to scroll to, only a
                // row, so the bar moves in whole rows.
                let last = count.saturating_sub(*visible);
                state.scroll_to_reveal_item((progress * last as f32).round() as usize);
            }
        }
    }
}

fn set_offset(handle: &gpui::ScrollHandle, progress: f32, vertical: bool) {
    let max = handle.max_offset();
    let mut offset = handle.offset();
    match vertical {
        true => offset.y = -max.y * progress,
        false => offset.x = -max.x * progress,
    }
    handle.set_offset(offset);
}

/// What the thumb looks like, taken from the `thumbStyle` prop.
struct Thumb {
    color: gpui::Hsla,
    radius: Pixels,
    minimum: Pixels,
}

fn thumb(style: Option<&WireStyle>) -> Thumb {
    let color = style
        .and_then(|style| style.background)
        .map(Into::into)
        .unwrap_or_else(|| hsla(0., 0., 1., 0.25));
    let radius = style
        .and_then(|style| style.corner_radii.as_ref())
        .and_then(|corners| corners.top_left)
        .map(|length| length.to_absolute().to_pixels(px(16.)))
        .unwrap_or(px(3.));
    let minimum = style
        .and_then(|style| style.min_size.as_ref())
        .and_then(|size| size.height.or(size.width))
        .map(|length| length.to_absolute().to_pixels(px(16.)))
        .unwrap_or(px(24.));
    Thumb {
        color,
        radius,
        minimum,
    }
}

pub struct Scrollbar {
    pub id: NodeId,
    pub target: NodeId,
    pub tree: Shared,
    pub vertical: bool,
    pub thumb: Option<WireStyle>,
    /// Where the pointer grabbed the thumb, in pixels from its leading edge.
    /// Held across frames, which is what makes a drag a drag.
    pub grab: Rc<Cell<Option<f32>>>,
}

impl IntoElement for Scrollbar {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for Scrollbar {
    type RequestLayoutState = ();
    type PrepaintState = (Option<Bounds<Pixels>>, Hitbox);

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mut style = Style::default();
        style.size = size(relative(1.), relative(1.)).map(Into::into);
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        _cx: &mut App,
    ) -> Self::PrepaintState {
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        let Some(target) = target(&self.tree, self.target) else {
            return (None, hitbox);
        };
        let metrics = target.metrics(self.vertical);
        // Nothing to scroll, nothing to show. A bar over content that fits is
        // just a smear of colour that does not respond to anything.
        if metrics.extent >= 1. {
            return (None, hitbox);
        }

        let style = thumb(self.thumb.as_ref());
        let track = match self.vertical {
            true => bounds.size.height,
            false => bounds.size.width,
        };
        let (length, travel) = travel(f32::from(track), metrics.extent, f32::from(style.minimum));
        let (length, start) = (px(length), px(travel * metrics.progress));
        let thumb = match self.vertical {
            true => Bounds::new(
                bounds.origin + point(px(0.), start),
                size(bounds.size.width, length),
            ),
            false => Bounds::new(
                bounds.origin + point(start, px(0.)),
                size(length, bounds.size.height),
            ),
        };
        (Some(thumb), hitbox)
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        _cx: &mut App,
    ) {
        let (thumb_bounds, hitbox) = prepaint;
        let Some(thumb_bounds) = *thumb_bounds else {
            return;
        };
        let style = thumb(self.thumb.as_ref());
        window.paint_quad(fill(thumb_bounds, style.color).corner_radii(style.radius));

        let vertical = self.vertical;
        let (track, thumb_length, thumb_start) = match vertical {
            true => (
                f32::from(bounds.size.height),
                f32::from(thumb_bounds.size.height),
                f32::from(thumb_bounds.origin.y - bounds.origin.y),
            ),
            false => (
                f32::from(bounds.size.width),
                f32::from(thumb_bounds.size.width),
                f32::from(thumb_bounds.origin.x - bounds.origin.x),
            ),
        };
        let travel = track - thumb_length;
        let origin = match vertical {
            true => f32::from(bounds.origin.y),
            false => f32::from(bounds.origin.x),
        };
        let along = move |position: gpui::Point<Pixels>| match vertical {
            true => f32::from(position.y),
            false => f32::from(position.x),
        };

        let target = target(&self.tree, self.target);
        let Some(target) = target else { return };
        let target = Rc::new(target);

        let grab = self.grab.clone();
        let hit = hitbox.clone();
        let pressed = target.clone();
        window.on_mouse_event(move |event: &MouseDownEvent, phase, _window, _cx| {
            if phase != DispatchPhase::Bubble || !hit.is_hovered(_window) {
                return;
            }
            let at = along(event.position) - origin;
            if at >= thumb_start && at <= thumb_start + thumb_length {
                // Grabbing the thumb keeps the point under the pointer.
                grab.set(Some(at - thumb_start));
                return;
            }
            // Clicking the track puts the thumb where it was clicked, centred,
            // and then behaves as though it had been grabbed there.
            let centred = (at - thumb_length / 2.).clamp(0., travel.max(0.));
            grab.set(Some(thumb_length / 2.));
            if travel > 0. {
                pressed.scroll_to(centred / travel, vertical);
            }
        });

        let grab = self.grab.clone();
        let dragged = target.clone();
        window.on_mouse_event(move |event: &MouseMoveEvent, phase, _window, _cx| {
            if phase != DispatchPhase::Bubble {
                return;
            }
            let Some(held) = grab.get() else { return };
            // The button can be released outside the window, where no mouse-up
            // ever arrives; a move without it held means the drag is over.
            if !event.dragging() {
                grab.set(None);
                return;
            }
            if travel <= 0. {
                return;
            }
            let at = along(event.position) - origin - held;
            dragged.scroll_to(at / travel, vertical);
        });

        let grab = self.grab.clone();
        window.on_mouse_event(move |_event: &MouseUpEvent, phase, _window, _cx| {
            if phase == DispatchPhase::Bubble {
                grab.set(None);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{geometry, travel};

    #[test]
    fn a_viewport_showing_everything_needs_no_thumb() {
        let metrics = geometry(400., 0., 0.);
        assert_eq!(metrics.extent, 1.);
        assert_eq!(metrics.progress, 0.);
    }

    #[test]
    fn the_thumb_is_the_visible_share_of_the_content() {
        // 400 on screen, 1600 in total.
        let metrics = geometry(400., 1200., 0.);
        assert_eq!(metrics.extent, 0.25);
    }

    #[test]
    fn progress_runs_from_the_top_to_the_last_scrollable_pixel() {
        assert_eq!(geometry(400., 1200., 0.).progress, 0.);
        assert_eq!(geometry(400., 1200., 600.).progress, 0.5);
        assert_eq!(geometry(400., 1200., 1200.).progress, 1.);
        // Past the end, which gpui allows momentarily while rubber-banding.
        assert_eq!(geometry(400., 1200., 2000.).progress, 1.);
    }

    #[test]
    fn a_thumb_stays_grabbable_in_a_very_long_list() {
        // Twenty rows of five thousand: a proportional thumb would be a
        // fraction of a pixel.
        let (thumb, travel) = travel(500., 0.004, 24.);
        assert_eq!(thumb, 24.);
        assert_eq!(travel, 476.);
    }

    #[test]
    fn a_thumb_never_outgrows_its_track() {
        let (thumb, travel) = travel(80., 1., 24.);
        assert_eq!(thumb, 80.);
        assert_eq!(travel, 0.);
    }
}
