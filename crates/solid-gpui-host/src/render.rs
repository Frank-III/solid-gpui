//! Turns the mirrored tree into gpui elements.
//!
//! This runs on every repaint, so it does no parsing: styles were converted
//! when they were set, and listeners are attached as thin closures that forward
//! the event to JavaScript and return.

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

use gpui::{
    Animation, AnimationExt, AnyElement, AppContext, ClickEvent, Context, CursorStyle, Display,
    Div, InteractiveElement, IntoElement, KeyDownEvent, MouseButton, MouseDownEvent, MouseExitEvent,
    MouseMoveEvent, MousePressureEvent, MouseUpEvent, ParentElement, PinchEvent, Point, Render,
    ScrollDelta, ScrollWheelEvent, SharedString, StatefulInteractiveElement, Stateful, Styled,
    StyleRefinement, Window, anchored, deferred, div, hsla, img, px, svg, uniform_list,
};
use serde_json::{Value, json};

use crate::input::{
    Backspace, Copy, Cut, Delete, End, Home, Left, Paste, Right, SelectAll, SelectLeft, SelectRight,
    ShowCharacterPalette, TextElement,
};
use crate::protocol::NodeId;
use crate::style::{self, WireStyle};
use crate::tree::{Node, NodeKind, Tree};

/// The tree is shared rather than borrowed for the whole build because two
/// elements need it later than their own construction: a virtualised list is
/// asked for rows during layout, and a tooltip or drag preview builds a subtree
/// when it is first shown.
pub type Shared = Rc<RefCell<Tree>>;

/// What a drag started in this window carries.
#[derive(Clone)]
pub struct DragPayload {
    pub data: Value,
    pub source: NodeId,
}

fn point_json(point: Point<gpui::Pixels>) -> Value {
    json!({ "x": f32::from(point.x), "y": f32::from(point.y) })
}

fn modifiers_json(modifiers: gpui::Modifiers) -> Value {
    json!({
        "control": modifiers.control,
        "alt": modifiers.alt,
        "shift": modifiers.shift,
        "platform": modifiers.platform,
        "function": modifiers.function,
    })
}

fn button_name(button: MouseButton) -> &'static str {
    match button {
        MouseButton::Left => "left",
        MouseButton::Right => "right",
        MouseButton::Middle => "middle",
        MouseButton::Navigate(gpui::NavigationDirection::Back) => "navigate-back",
        MouseButton::Navigate(gpui::NavigationDirection::Forward) => "navigate-forward",
    }
}

pub fn keystroke_json(keystroke: &gpui::Keystroke, repeat: bool) -> Value {
    json!({
        "keystroke": keystroke.to_string(),
        "key": keystroke.key,
        "text": keystroke.key_char,
        "modifiers": modifiers_json(keystroke.modifiers),
        "repeat": repeat,
    })
}

fn click_json(event: &ClickEvent) -> Value {
    let (click_count, button, down) = match event {
        ClickEvent::Mouse(mouse) => (
            mouse.up.click_count,
            button_name(mouse.up.button),
            point_json(mouse.down.position),
        ),
        ClickEvent::Touch(touch) => (touch.tap_count, "left", point_json(touch.position)),
        ClickEvent::Keyboard(_) => (1, "left", point_json(event.position())),
    };
    json!({
        "position": point_json(event.position()),
        "modifiers": modifiers_json(event.modifiers()),
        "button": button,
        "clickCount": click_count,
        "down": down,
    })
}

/// A plain-text tooltip; gpui has no built-in one because Zed supplies its own.
struct TextTooltip {
    text: SharedString,
}

impl Render for TextTooltip {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .px(px(8.))
            .py(px(4.))
            .bg(hsla(0., 0., 0.12, 0.95))
            .text_color(hsla(0., 0., 0.95, 1.))
            .rounded(px(4.))
            .child(self.text.clone())
    }
}

/// Renders a node that is referenced by a prop rather than parented in the
/// tree: a tooltip written as JSX, or the preview shown while dragging.
struct SubtreeView {
    tree: Shared,
    id: NodeId,
}

impl Render for SubtreeView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        build(&self.tree, self.id)
    }
}

/// Applies the styles, groups, tooltips and listeners shared by every element.
fn decorate<E>(mut element: E, node: &Node, tree: &Shared) -> E
where
    E: Styled + StatefulInteractiveElement,
{
    // Merged rather than assigned: an element may have configured its own
    // refinement before this ever runs.
    if let Some(base) = node.style.as_ref() {
        style::apply(base, element.style());
    }

    if let Some(group) = node.prop_str("group") {
        element = element.group(SharedString::from(group.to_owned()));
    }
    if node.prop_bool("occlude") {
        element = element.occlude();
    }
    if let Some(focus) = node.focus.as_ref() {
        element = element.track_focus(focus);
        if let Some(index) = node.prop_f32("tabIndex") {
            element = element.tab_index(index as isize);
        }
    }
    // A virtualised list keeps its own scroll state, and attaching a generic
    // handle on top of it fights with the offset it maintains internally.
    if let Some(scroll) = node.scroll.as_ref().filter(|_| node.tag != "uniform-list") {
        // gpui counts a downward scroll as a negative offset; the props read the
        // way the web does, so the sign is flipped here rather than in JS.
        let offset = Point {
            x: px(-node.prop_f32("scrollLeft").unwrap_or(0.)),
            y: px(-node.prop_f32("scrollTop").unwrap_or(0.)),
        };
        scroll.set_offset(offset);
        element = element.track_scroll(scroll);
    }

    if let Some(hover) = node.hover_style.clone() {
        element = element.hover(move |mut base: StyleRefinement| {
            style::apply(&hover, &mut base);
            base
        });
    }
    if let Some(active) = node.active_style.clone() {
        element = element.active(move |mut base: StyleRefinement| {
            style::apply(&active, &mut base);
            base
        });
    }
    if let Some(over) = node.drag_over_style.clone() {
        element = element.drag_over::<DragPayload>(
            move |mut base: StyleRefinement, _payload, _window, _cx| {
                style::apply(&over, &mut base);
                base
            },
        );
    }
    if let Some(group) = node.prop_str("groupOf").map(str::to_owned) {
        if let Some(hover) = node.group_hover_style.clone() {
            element = element.group_hover(group.clone(), move |mut base: StyleRefinement| {
                style::apply(&hover, &mut base);
                base
            });
        }
        if let Some(active) = node.group_active_style.clone() {
            element = element.group_active(group, move |mut base: StyleRefinement| {
                style::apply(&active, &mut base);
                base
            });
        }
    }

    if let Some(id) = node.prop_node("tooltip") {
        let tree = tree.clone();
        element = element.tooltip(move |_window, cx| {
            let tree = tree.clone();
            cx.new(|_| SubtreeView { tree, id }).into()
        });
    } else if let Some(tooltip) = node.prop_str("tooltip").map(str::to_owned) {
        element = element.tooltip(move |_window, cx| {
            let text = SharedString::from(tooltip.clone());
            cx.new(|_| TextTooltip { text }).into()
        });
    }

    let id = node.id;

    if node.props.contains_key("dragData") {
        let data = node.props.get("dragData").cloned().unwrap_or(Value::Null);
        let announce = node.listens_to("dragStart");
        let tree = tree.clone();
        element = element.on_drag(
            DragPayload {
                data: data.clone(),
                source: id,
            },
            move |payload, position, _window, cx| {
                if announce {
                    crate::emit_event(
                        id,
                        "dragStart",
                        json!({ "data": payload.data, "position": point_json(position) }),
                    );
                }
                let tree = tree.clone();
                cx.new(|_| SubtreeView { tree, id })
            },
        );
    }
    if node.listens_to("drop") {
        element = element.on_drop(move |payload: &DragPayload, window, _cx| {
            crate::emit_event(
                id,
                "drop",
                json!({
                    "data": payload.data,
                    "source": payload.source,
                    "position": point_json(window.mouse_position()),
                }),
            );
        });
    }

    if node.listens_to("click") {
        element = element.on_click(move |event, _window, _cx| {
            crate::emit_event(id, "click", click_json(event));
        });
    }
    if node.listens_to("auxClick") {
        element = element.on_aux_click(move |event, _window, _cx| {
            crate::emit_event(id, "auxClick", click_json(event));
        });
    }
    if node.listens_to("mouseDown") {
        element = element.on_any_mouse_down(move |event: &MouseDownEvent, _window, _cx| {
            crate::emit_event(
                id,
                "mouseDown",
                json!({
                    "position": point_json(event.position),
                    "modifiers": modifiers_json(event.modifiers),
                    "button": button_name(event.button),
                    "clickCount": event.click_count,
                }),
            );
        });
    }
    if node.listens_to("mouseUp") {
        // There is no `on_any_mouse_up`, so the two buttons that matter are
        // registered separately.
        for button in [MouseButton::Left, MouseButton::Right] {
            element = element.on_mouse_up(button, move |event: &MouseUpEvent, _window, _cx| {
                crate::emit_event(
                    id,
                    "mouseUp",
                    json!({
                        "position": point_json(event.position),
                        "modifiers": modifiers_json(event.modifiers),
                        "button": button_name(event.button),
                        "clickCount": event.click_count,
                    }),
                );
            });
        }
    }
    if node.listens_to("mouseMove") {
        element = element.on_mouse_move(move |event: &MouseMoveEvent, _window, _cx| {
            crate::emit_event(
                id,
                "mouseMove",
                json!({
                    "position": point_json(event.position),
                    "modifiers": modifiers_json(event.modifiers),
                }),
            );
        });
    }
    if node.listens_to("mouseExit") {
        element = element.on_mouse_exit(move |event: &MouseExitEvent, _window, _cx| {
            crate::emit_event(
                id,
                "mouseExit",
                json!({
                    "position": point_json(event.position),
                    "modifiers": modifiers_json(event.modifiers),
                }),
            );
        });
    }
    if node.listens_to("mousePressure") {
        element = element.on_mouse_pressure(move |event: &MousePressureEvent, _window, _cx| {
            crate::emit_event(
                id,
                "mousePressure",
                json!({
                    "position": point_json(event.position),
                    "modifiers": modifiers_json(event.modifiers),
                    "pressure": event.pressure,
                    "stage": match event.stage {
                        gpui::PressureStage::Zero => "zero",
                        gpui::PressureStage::Normal => "normal",
                        gpui::PressureStage::Force => "force",
                    },
                }),
            );
        });
    }
    if node.listens_to("pinch") {
        element = element.on_pinch(move |event: &PinchEvent, _window, _cx| {
            crate::emit_event(
                id,
                "pinch",
                json!({
                    "position": point_json(event.position),
                    "modifiers": modifiers_json(event.modifiers),
                    "delta": event.delta,
                    "phase": match event.phase {
                        gpui::TouchPhase::Started => "started",
                        gpui::TouchPhase::Moved => "moved",
                        gpui::TouchPhase::Ended => "ended",
                        gpui::TouchPhase::Cancelled => "ended",
                    },
                }),
            );
        });
    }
    if node.listens_to("scrollWheel") {
        element = element.on_scroll_wheel(move |event: &ScrollWheelEvent, _window, _cx| {
            let (delta, unit) = match event.delta {
                ScrollDelta::Pixels(delta) => (point_json(delta), "pixels"),
                ScrollDelta::Lines(delta) => (json!({ "x": delta.x, "y": delta.y }), "lines"),
            };
            crate::emit_event(
                id,
                "scrollWheel",
                json!({
                    "position": point_json(event.position),
                    "modifiers": modifiers_json(event.modifiers),
                    "delta": delta,
                    "deltaUnit": unit,
                }),
            );
        });
    }
    if node.listens_to("hover") {
        element = element.on_hover(move |hovered: &bool, _window, _cx| {
            crate::emit_event(id, "hover", json!({ "value": hovered }));
        });
    }

    // Key events reach a focusable element only while it holds focus; the
    // window fans the rest out, which is why they are attached here only when
    // the element can actually be focused.
    if node.is_focusable() {
        if node.listens_to("keyDown") {
            element = element.on_key_down(move |event: &KeyDownEvent, _window, _cx| {
                crate::emit_event(id, "keyDown", keystroke_json(&event.keystroke, event.is_held));
            });
        }
        if node.listens_to("keyUp") {
            element = element.on_key_up(move |event: &gpui::KeyUpEvent, _window, _cx| {
                crate::emit_event(id, "keyUp", keystroke_json(&event.keystroke, false));
            });
        }
    }

    element
}

fn easing(name: &str) -> Box<dyn Fn(f32) -> f32> {
    match name {
        "linear" => Box::new(gpui::linear),
        "quadratic" => Box::new(gpui::quadratic),
        "ease-out-quint" => Box::new(gpui::ease_out_quint()),
        "bounce" => Box::new(gpui::bounce(gpui::ease_in_out)),
        _ => Box::new(gpui::ease_in_out),
    }
}

/// Wraps the finished element in its animation, if it has one. This has to be
/// the last step: the animation element is neither styled nor a parent, so
/// nothing can be added to it afterwards.
fn finish<E>(element: E, node: &Node) -> AnyElement
where
    E: Styled + IntoElement + 'static,
{
    let Some(animation) = node.animation.clone() else {
        return element.into_any_element();
    };
    let mut spec = Animation::new(Duration::from_millis(animation.duration_ms.max(0.) as u64))
        .with_easing(easing(&animation.easing));
    if animation.repeat {
        spec = spec.repeat();
    }
    if let Some(fps) = animation.max_fps {
        spec = spec.with_max_fps(fps);
    }
    let from = animation.from.clone();
    let to = animation.to.clone();
    element
        .with_animation(node.element_id.clone(), spec, move |mut element, delta| {
            let frame: WireStyle = style::lerp(&from, &to, delta);
            style::apply(&frame, element.style());
            element
        })
        .into_any_element()
}

/// Builds the element for one node, recursing through its children.
pub fn build(tree: &Shared, id: NodeId) -> AnyElement {
    let borrowed = tree.borrow();
    let Some(node) = borrowed.get(id) else {
        return div().into_any_element();
    };

    if node.kind == NodeKind::Text {
        return div().flex().child(node.text.clone()).into_any_element();
    }

    match node.tag.as_str() {
        "img" => {
            let source = node.prop_str("src").unwrap_or_default().to_owned();
            finish(
                decorate(img(source).id(node.element_id.clone()), node, tree),
                node,
            )
        }
        "svg" => {
            let path = node.prop_str("path").unwrap_or_default().to_owned();
            finish(
                decorate(
                    svg().path(SharedString::from(path)).id(node.element_id.clone()),
                    node,
                    tree,
                ),
                node,
            )
        }
        "input" => build_input(node, tree),
        "uniform-list" => build_uniform_list(node, tree),
        "anchored" => {
            let mut element = anchored();
            if let Some(name) = node.prop_str("anchor") {
                element = element.anchor(match name {
                    "top-right" => gpui::Anchor::TopRight,
                    "bottom-left" => gpui::Anchor::BottomLeft,
                    "bottom-right" => gpui::Anchor::BottomRight,
                    "top-center" => gpui::Anchor::TopCenter,
                    "bottom-center" => gpui::Anchor::BottomCenter,
                    "left-center" => gpui::Anchor::LeftCenter,
                    "right-center" => gpui::Anchor::RightCenter,
                    _ => gpui::Anchor::TopLeft,
                });
            }
            if let Some(position) = node.props.get("position") {
                element = element.position(gpui::point(
                    px(position.get("x").and_then(Value::as_f64).unwrap_or(0.) as f32),
                    px(position.get("y").and_then(Value::as_f64).unwrap_or(0.) as f32),
                ));
            }
            if let Some(offset) = node.props.get("offset") {
                element = element.offset(gpui::point(
                    px(offset.get("x").and_then(Value::as_f64).unwrap_or(0.) as f32),
                    px(offset.get("y").and_then(Value::as_f64).unwrap_or(0.) as f32),
                ));
            }
            if node.prop_bool("snapToWindow") {
                element = match node.prop_f32("snapMargin") {
                    Some(margin) => element.snap_to_window_with_margin(px(margin)),
                    None => element.snap_to_window(),
                };
            }
            // `Anchored` is neither styled nor interactive, so the styles and
            // listeners live on a container it wraps.
            element.child(container(node, tree)).into_any_element()
        }
        "deferred" => {
            let mut element = deferred(container(node, tree));
            if let Some(priority) = node.prop_f32("priority") {
                element = element.with_priority(priority as usize);
            }
            element.into_any_element()
        }
        _ => finish(container(node, tree), node),
    }
}

/// A styled, interactive `div` holding the node's children.
fn container(node: &Node, tree: &Shared) -> Stateful<Div> {
    let mut element = decorate(div().id(node.element_id.clone()), node, tree);
    // gpui's `Style::default()` is `display: block`, which is why hand-written
    // gpui code calls `.flex()` on nearly every div. The element model this
    // renderer exposes is flexbox — `flexDirection`, `alignItems`,
    // `justifyContent` and `gap` are documented to work on a bare `<div>` — so
    // anything that did not ask for another display gets flex.
    if element.style().display.is_none() {
        element.style().display = Some(Display::Flex);
    }
    // Consecutive text nodes are concatenated: `<div>#{n}</div>` compiles to two
    // adjacent text nodes, and emitting them as two children would lay them out
    // as two boxes instead of one run of text.
    let borrowed = tree.borrow();
    let mut run = String::new();
    for child in &node.children {
        match borrowed.get(*child) {
            Some(child_node) if child_node.kind == NodeKind::Text => {
                run.push_str(&child_node.text);
            }
            Some(_) => {
                if !run.is_empty() {
                    element = element.child(SharedString::from(std::mem::take(&mut run)));
                }
                element = element.child(build(tree, *child));
            }
            None => {}
        }
    }
    if !run.is_empty() {
        element = element.child(SharedString::from(run));
    }
    element
}

fn build_input(node: &Node, tree: &Shared) -> AnyElement {
    let (Some(state), Some(focus)) = (node.input.clone(), node.focus.clone()) else {
        return div().into_any_element();
    };
    let mut element = decorate(div().id(node.element_id.clone()), node, tree);
    if element.style().display.is_none() {
        element.style().display = Some(Display::Flex);
    }
    element = element
        .key_context("SolidGpuiInput")
        .track_focus(&focus)
        .cursor(CursorStyle::IBeam);

    macro_rules! action {
        ($action:ty, $method:ident) => {{
            let state = state.clone();
            element = element.on_action(move |action: &$action, window, cx| {
                state.update(cx, |input, cx| input.$method(action, window, cx));
                window.refresh();
            });
        }};
    }
    action!(Backspace, backspace);
    action!(Delete, delete);
    action!(Left, left);
    action!(Right, right);
    action!(SelectLeft, select_left);
    action!(SelectRight, select_right);
    action!(SelectAll, select_all);
    action!(Home, home);
    action!(End, end);
    action!(Paste, paste);
    action!(Copy, copy);
    action!(Cut, cut);
    action!(ShowCharacterPalette, show_character_palette);

    let down = state.clone();
    element = element.on_mouse_down(MouseButton::Left, move |event, window, cx| {
        down.update(cx, |input, cx| input.on_mouse_down(event, window, cx));
        window.refresh();
    });
    let up = state.clone();
    element = element.on_mouse_up(MouseButton::Left, move |event, window, cx| {
        up.update(cx, |input, cx| input.on_mouse_up(event, window, cx));
        window.refresh();
    });
    let moved = state.clone();
    element = element.on_mouse_move(move |event, window, cx| {
        moved.update(cx, |input, cx| input.on_mouse_move(event, window, cx));
        window.refresh();
    });

    finish(element.child(TextElement { input: state }), node)
}

/// The row gpui renders to measure the height of every other row. It is
/// `UniformList::item_to_measure_index`, which is zero unless
/// `with_width_from_item` changes it, and this renderer never does.
const MEASURE_INDEX: usize = 0;

fn build_uniform_list(node: &Node, tree: &Shared) -> AnyElement {
    let count = node.prop_usize("count").unwrap_or(0);
    let start = node.prop_usize("start").unwrap_or(0);
    let children = node.children.clone();
    let announce = node.listens_to("range");
    let id = node.id;
    let rows = tree.clone();

    let mut element = uniform_list(
        node.element_id.clone(),
        count,
        move |range, _window, _cx| {
            // Before laying the list out, gpui measures one row to learn the row
            // height — from `request_layout` and again from `prepaint`, both
            // times as exactly `MEASURE_INDEX..MEASURE_INDEX + 1`. Those are not
            // viewport requests. Reporting them as one told JavaScript the
            // viewport had jumped back to the top of the list on every frame,
            // which is what emptied the list while scrolling.
            let measuring = range.start == MEASURE_INDEX && range.end == MEASURE_INDEX + 1;

            // gpui asks for the visible range while it is laying out, and the
            // answer cannot wait for a round trip. The rows JavaScript has
            // already rendered are used as they are, and the request is
            // forwarded so the next frame has the rest — a fast scroll shows one
            // frame of catch-up.
            if announce && !measuring {
                let wanted = (range.start, range.end);
                let stale = rows
                    .borrow()
                    .get(id)
                    .map(|node| node.last_range.get() != Some(wanted))
                    .unwrap_or(false);
                if stale {
                    if let Some(node) = rows.borrow().get(id) {
                        node.last_range.set(Some(wanted));
                    }
                    crate::emit_event(
                        id,
                        "range",
                        json!({ "start": range.start, "end": range.end }),
                    );
                }
            }

            range
                .map(|index| {
                    let child = index
                        .checked_sub(start)
                        .and_then(|offset| children.get(offset));
                    match child {
                        Some(child) => build(&rows, *child),
                        // Every row's position is derived from the measured
                        // height, so the measurement must never come back empty.
                        // Once the list is scrolled, row 0 is no longer rendered,
                        // and any row that is will do.
                        None if measuring => match children.first() {
                            Some(child) => build(&rows, *child),
                            None => div().into_any_element(),
                        },
                        None => div().into_any_element(),
                    }
                })
                .collect::<Vec<_>>()
        },
    );

    if let Some(scroll) = node.list_scroll.as_ref() {
        element = element.track_scroll(scroll);
        // Only on change: scrolling to the same row on every repaint would pin
        // the list there and fight the user trying to scroll away from it.
        let requested = node.prop_usize("scrollToItem");
        if requested != node.last_scroll_to.get() {
            node.last_scroll_to.set(requested);
            if let Some(index) = requested {
                scroll.scroll_to_item(index, gpui::ScrollStrategy::Top);
            }
        }
    }

    finish(
        decorate(element.id(node.element_id.clone()), node, tree),
        node,
    )
}

/// Reports a key event to every node that registered the matching listener and
/// is not focusable. gpui delivers key events along the focus path, so a
/// focusable element handles its own; everything else hears the window's.
pub fn dispatch_key(tree: &Tree, event_name: &'static str, payload: &Value) {
    let Some(root) = tree.root else { return };
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        let Some(node) = tree.get(id) else { continue };
        if node.listens_to(event_name) && !node.is_focusable() {
            crate::emit_event(id, event_name, payload.clone());
        }
        stack.extend(node.children.iter().copied());
    }
}

/// Emits `scroll` for any element whose offset moved since the last frame.
pub fn report_scrolls(tree: &Tree) {
    for node in tree.scrollables() {
        let Some(scroll) = node.scroll.as_ref() else {
            continue;
        };
        if !node.listens_to("scroll") {
            continue;
        }
        let offset = scroll.offset();
        let current = (f32::from(-offset.x), f32::from(-offset.y));
        if node.last_scroll.get() == Some(current) {
            continue;
        }
        node.last_scroll.set(Some(current));
        let max = scroll.max_offset();
        crate::emit_event(
            node.id,
            "scroll",
            json!({
                "offset": { "x": current.0, "y": current.1 },
                "maxOffset": { "x": f32::from(-max.x), "y": f32::from(-max.y) },
            }),
        );
    }
}

/// Kept for symmetry with `dispatch_key`; both take `KeyDownEvent`-shaped data.
pub fn key_payload(event: &KeyDownEvent) -> Value {
    keystroke_json(&event.keystroke, event.is_held)
}
