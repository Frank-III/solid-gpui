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
    Div, FollowMode, HighlightStyle, InteractiveElement, InteractiveText, IntoElement,
    KeyDownEvent, ListAlignment, ListState, MouseButton, MouseDownEvent, MouseExitEvent,
    MouseMoveEvent, MousePressureEvent, MouseUpEvent, ParentElement, PinchEvent, Point, Render,
    ScrollDelta, ScrollWheelEvent, SharedString, Stateful, StatefulInteractiveElement,
    StyleRefinement, Styled, StyledText, Window, anchored, deferred, div, hsla, image_cache, img,
    list, px, retain_all, svg, uniform_list,
};
use serde_json::{Value, json};

use crate::input::{
    Backspace, Copy, Cut, Delete, Down, End, Home, Left, Newline, Paste, Right, SelectAll,
    SelectDown, SelectLeft, SelectRight, SelectUp, ShowCharacterPalette, TextElement, Up,
};
use crate::protocol::NodeId;
use crate::style::{self, WireStyle, WireTextStyle};
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

    // A focusable element's bindings are scoped to it by a key context, which
    // gpui matches while the element or a descendant holds focus.
    if !node.keys.is_empty() && node.is_focusable() {
        if let Ok(context) = gpui::KeyContext::try_from(crate::keys::context(node.id).as_str()) {
            element = element.key_context(context);
        }
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
                crate::emit_event(
                    id,
                    "keyDown",
                    keystroke_json(&event.keystroke, event.is_held),
                );
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
                    svg()
                        .path(SharedString::from(path))
                        .id(node.element_id.clone()),
                    node,
                    tree,
                ),
                node,
            )
        }
        "input" => build_input(node, tree),
        "codeSurface" => build_code_surface(node, tree),
        "uniform-list" => build_uniform_list(node, tree),
        "list" => build_list(node, tree),
        "image-cache" => build_image_cache(node, tree),
        "canvas" => build_canvas(node, tree),
        "scrollbar" => build_scrollbar(node, tree),
        // The menu bar is read out of the tree and handed to the platform, so
        // the tags that describe it paint nothing.
        "menu" | "item" | "separator" => gpui::Empty.into_any_element(),
        "text" => build_text(node, tree),
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

/// Reports an element's size, once gpui has laid it out.
///
/// gpui has no hook for this, so the size is taken by an empty canvas laid over
/// the element: positioned absolutely and filling its parent, it measures the
/// parent without taking any part in its layout. That is also why only elements
/// which can hold children report their size — an `<img>` has nowhere to put it.
fn measure<E: ParentElement>(element: E, node: &Node, tree: &Shared) -> E {
    if !node.listens_to("resize") {
        return element;
    }
    let id = node.id;
    let sizes = tree.clone();
    element.child(
        gpui::canvas(
            move |bounds, _window, _cx| {
                let size = (f32::from(bounds.size.width), f32::from(bounds.size.height));
                let borrowed = sizes.borrow();
                if let Some(node) = borrowed.get(id)
                    && node.last_size.get() != Some(size)
                {
                    node.last_size.set(Some(size));
                    crate::emit_event(id, "resize", json!({ "width": size.0, "height": size.1 }));
                }
            },
            |_bounds, _prepaint, _window, _cx| {},
        )
        .absolute()
        .size_full(),
    )
}

/// A styled, interactive `div` with nothing in it, for the elements that hold
/// their children some other way than by parenting them.
fn shell(node: &Node, tree: &Shared) -> Stateful<Div> {
    let mut element = decorate(div().id(node.element_id.clone()), node, tree);
    // gpui's `Style::default()` is `display: block`, which is why hand-written
    // gpui code calls `.flex()` on nearly every div. The element model this
    // renderer exposes is flexbox — `flexDirection`, `alignItems`,
    // `justifyContent` and `gap` are documented to work on a bare `<div>` — so
    // anything that did not ask for another display gets flex.
    if element.style().display.is_none() {
        // gpui measures a line of text at its full width even when asked for
        // the smallest it could be, so as a flex item it would never shrink,
        // and a long line would run out of its container instead of wrapping.
        // Laid out as a block it is handed the container's width and wraps
        // within it, which is what `<text>` is for.
        element.style().display = Some(if node.tag == "text" {
            Display::Block
        } else {
            Display::Flex
        });
    }
    measure(element, node, tree)
}

/// Adds a node's children to an element that can hold them.
///
/// Consecutive text nodes are concatenated: `<div>#{n}</div>` compiles to two
/// adjacent text nodes, and emitting them as two children would lay them out as
/// two boxes instead of one run of text.
fn append_children<E: ParentElement>(mut element: E, node: &Node, tree: &Shared) -> E {
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

/// A styled, interactive `div` holding the node's children.
fn container(node: &Node, tree: &Shared) -> Stateful<Div> {
    append_children(shell(node, tree), node, tree)
}

/// A scope in which every `<img>` shares one cache.
///
/// gpui drops a decoded image as soon as nothing is painting it, so an image
/// scrolled out of a list is decoded again when it comes back. Wrapping the list
/// in this keeps them.
///
/// It carries the node's style, so it lays out exactly like the `<div>` it
/// replaces, but it is not interactive: gpui's cache element is styled and can
/// hold children, and is neither hoverable nor clickable. Put listeners on
/// something inside it.
fn build_image_cache(node: &Node, tree: &Shared) -> AnyElement {
    let mut element = image_cache(retain_all(node.element_id.clone()));
    if let Some(base) = node.style.as_ref() {
        style::apply(base, element.style());
    }
    if element.style().display.is_none() {
        element.style().display = Some(Display::Flex);
    }
    finish(
        append_children(measure(element, node, tree), node, tree),
        node,
    )
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
    action!(Up, up);
    action!(Down, down);
    action!(SelectUp, select_up);
    action!(SelectDown, select_down);
    action!(Newline, newline);

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

fn build_code_surface(node: &Node, tree: &Shared) -> AnyElement {
    let mut element = decorate(div().id(node.element_id.clone()), node, tree);
    if element.style().display.is_none() {
        element.style().display = Some(Display::Flex);
    }
    if let Some(surface) = node.code_surface.clone() {
        element = element.child(surface);
    }
    finish(element, node)
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

/// Rows are asked for in chunks. gpui walks a variable-height list one index at
/// a time, so an unchunked request would send one message per row scrolled past.
const LIST_CHUNK: usize = 16;

/// Asks JavaScript for a range of rows, if it is not the range already asked
/// for. `grow` widens the standing request instead of replacing it: the rows a
/// frame turns out to need arrive one index at a time, and each one has to add
/// to what came before rather than narrow the window to itself. A scroll
/// replaces the request outright, which is what keeps the window from growing
/// to cover the whole list.
fn request_rows(tree: &Shared, id: NodeId, start: usize, end: usize, grow: bool) {
    let borrowed = tree.borrow();
    let Some(node) = borrowed.get(id) else { return };
    if !node.listens_to("range") {
        return;
    }
    let count = node.prop_usize("count").unwrap_or(0);
    let (mut start, mut end) = (start, end);
    if grow
        && let Some((held, held_end)) = node.last_range.get()
        // Only rows next to the standing request join it. A list anchored to
        // its bottom starts laying out from the last row while JavaScript is
        // still showing the first, and widening the request to span both would
        // ask for every row in between — the whole list.
        && start + LIST_CHUNK >= held
        && end <= held_end + LIST_CHUNK
    {
        start = start.min(held);
        end = end.max(held_end);
    }
    let start = (start / LIST_CHUNK) * LIST_CHUNK;
    let end = (end.div_ceil(LIST_CHUNK) * LIST_CHUNK).min(count);
    if end <= start {
        return;
    }
    if node.last_range.get() == Some((start, end)) {
        return;
    }
    node.last_range.set(Some((start, end)));
    crate::emit_event(id, "range", json!({ "start": start, "end": end }));
}

/// A virtualised list whose rows may each be a different height.
///
/// Unlike a uniform list, gpui caches the height of every row it has measured,
/// which is what lets it scroll without laying the whole list out. The cache is
/// the reason this element carries more state than the others: it has to be
/// told when rows are inserted, and when a row that was a stand-in has been
/// replaced by the real thing.
fn build_list(node: &Node, tree: &Shared) -> AnyElement {
    let count = node.prop_usize("count").unwrap_or(0);
    let start = node.prop_usize("start").unwrap_or(0);
    let children = node.children.clone();
    let window = (start, start + children.len());
    let id = node.id;

    // Bound before the match: the borrow behind a `match` scrutinee lives to the
    // end of the match, and the arm that has to build the state writes to it.
    let existing = node.list.borrow().clone();
    let state = match existing {
        Some(state) => state,
        None => {
            // Built here rather than when `count` arrived, because the props
            // that configure it come in the same batch and in no fixed order.
            let alignment = match node.prop_str("align") {
                Some("bottom") => ListAlignment::Bottom,
                _ => ListAlignment::Top,
            };
            let overdraw = px(node.prop_f32("overdraw").unwrap_or(256.));
            let mut created = ListState::new(count, alignment, overdraw);
            if let Some(height) = node.prop_f32("itemHeight") {
                created = created.with_uniform_item_height(px(height));
            }
            let rows = tree.clone();
            created.set_scroll_handler(move |event, _window, _cx| {
                let visible = &event.visible_range;
                request_rows(&rows, id, visible.start, visible.end, false);
            });
            node.list_count.set(count);
            *node.list.borrow_mut() = Some(created.clone());
            created
        }
    };

    // Rows outside the window are drawn as empty stand-ins, and their heights
    // are cached like any other. Whenever the window moves, the rows it now
    // covers are measured again so the stand-in heights do not persist.
    if node.last_window.get() != Some(window) {
        node.last_window.set(Some(window));
        let end = window.1.min(count);
        if end > window.0 {
            state.remeasure_items(window.0..end);
        }
    }

    let follow = node.prop_str("follow") == Some("tail");
    if node.last_follow.get() != Some(follow) {
        node.last_follow.set(Some(follow));
        state.set_follow_mode(if follow {
            FollowMode::Tail
        } else {
            FollowMode::Normal
        });
    }

    // Only on change: scrolling to the same row on every repaint would pin the
    // list there and fight the user trying to scroll away from it.
    let requested = node.prop_usize("scrollToItem");
    if requested != node.last_scroll_to.get() {
        node.last_scroll_to.set(requested);
        if let Some(index) = requested {
            state.scroll_to_reveal_item(index);
        }
    }

    // A stand-in row is measured like any other, and a row measured at nothing
    // would tell the list that the whole of it fits on screen — which is the
    // one answer that makes it ask for every row at once. `itemHeight` is the
    // guess to use; the row is measured again for real once it arrives.
    let placeholder = px(node.prop_f32("itemHeight").unwrap_or(24.));

    let rows = tree.clone();
    let element = list(state, move |index, _window, _cx| {
        let child = index
            .checked_sub(start)
            .and_then(|offset| children.get(offset));
        match child {
            Some(child) => build(&rows, *child),
            None => {
                // The list is laying out and cannot wait for a round trip, so
                // the row is asked for and a blank one of about the right size
                // stands in until the next frame has it.
                request_rows(&rows, id, index, index + 1, true);
                div().h(placeholder).into_any_element()
            }
        }
    });

    let mut wrapper = shell(node, tree);
    // A scrolling list must not be sized by its contents: a flex item's
    // automatic minimum is its content, and for a list that is every row it has
    // measured, which would push the list — and its parent — far past the
    // window. Naming a `minWidth` or `minHeight` still overrides this.
    if wrapper.style().min_size.width.is_none() {
        wrapper.style().min_size.width = Some(px(0.).into());
    }
    if wrapper.style().min_size.height.is_none() {
        wrapper.style().min_size.height = Some(px(0.).into());
    }
    finish(wrapper.child(element.size_full()), node)
}

/// A surface the application draws on itself.
///
/// The drawing is a recording, not a callback: gpui repaints from its own scene
/// every frame and JavaScript is a process away, so the list of things to draw
/// arrives as a property and is replayed until it is replaced.
///
/// Its size comes back through `resize`, like any other element's — the only
/// thing that knows it is the layout that has just run.
fn build_canvas(node: &Node, tree: &Shared) -> AnyElement {
    let commands = node.commands.clone().unwrap_or_default();
    let element = gpui::canvas(
        |bounds, _window, _cx| bounds,
        move |_bounds, bounds, window, cx| crate::canvas::paint(&commands, bounds, window, cx),
    );

    finish(shell(node, tree).child(element.size_full()), node)
}

/// A scrollbar around whatever it scrolls.
///
/// It wraps its child rather than pointing at it: the bar has to be a sibling of
/// the scrolling content — inside it, it would scroll away — and wrapping is the
/// only arrangement where the thing being scrolled is guaranteed to exist by the
/// time the bar is built. Otherwise it is transparent: it stands where a
/// wrapping `<div>` would have stood, and takes the style that div would have.
fn build_scrollbar(node: &Node, tree: &Shared) -> AnyElement {
    let borrowed = tree.borrow();
    let target = node.children.iter().copied().find(|child| {
        borrowed
            .get(*child)
            .is_some_and(|child| child.kind == NodeKind::Element)
    });
    drop(borrowed);
    let Some(target) = target else {
        return finish(container(node, tree), node);
    };

    let vertical = node.prop_str("orientation") != Some("horizontal");
    let thickness = px(node.prop_f32("thickness").unwrap_or(8.));
    let bar = crate::scrollbar::Scrollbar {
        id: node.id,
        target,
        tree: tree.clone(),
        vertical,
        thumb: node.thumb_style.clone(),
        grab: node.grab.clone(),
    };

    let mut element = shell(node, tree);
    // The bar is placed against an edge of this element, so this element is what
    // "absolute" resolves against.
    if element.style().position.is_none() {
        element.style().position = Some(gpui::Position::Relative);
    }
    element = element.child(build(tree, target));

    let mut track = div().absolute();
    track = match vertical {
        true => track.top_0().right_0().bottom_0().w(thickness),
        false => track.left_0().right_0().bottom_0().h(thickness),
    };
    finish(element.child(track.child(bar)), node)
}

/// One run of text inside a `<text>`: either a bare string, or a `<span>` that
/// styles part of it.
struct TextSegment {
    text: String,
    style: Option<WireTextStyle>,
    span: Option<NodeId>,
    clickable: bool,
}

/// Splits a `<text>` into runs, or returns `None` if it holds anything that
/// cannot be part of one piece of text — a nested element, or a `<span>` around
/// something other than a string. Those fall back to being laid out as boxes.
fn text_segments(node: &Node, tree: &Tree) -> Option<Vec<TextSegment>> {
    let mut segments = Vec::new();
    for child in &node.children {
        let child = tree.get(*child)?;
        match child.kind {
            NodeKind::Text => segments.push(TextSegment {
                text: child.text.to_string(),
                style: None,
                span: None,
                clickable: false,
            }),
            NodeKind::Element if child.tag == "span" => {
                let mut text = String::new();
                for grandchild in &child.children {
                    let grandchild = tree.get(*grandchild)?;
                    if grandchild.kind != NodeKind::Text {
                        return None;
                    }
                    text.push_str(&grandchild.text);
                }
                segments.push(TextSegment {
                    text,
                    style: child.style.as_ref().and_then(|style| style.text.clone()),
                    span: Some(child.id),
                    clickable: child.listens_to("click"),
                });
            }
            _ => return None,
        }
    }
    Some(segments)
}

/// Text whose runs may be styled or clicked individually.
///
/// gpui lays a single string out as one block, and only within one block can it
/// wrap between two differently styled runs. A `<span>` is therefore not an
/// element of its own: it contributes a range of the surrounding string, and
/// the fields it can vary are the ones gpui allows to differ run by run.
fn build_text(node: &Node, tree: &Shared) -> AnyElement {
    let segments = text_segments(node, &tree.borrow());
    // Nothing to vary means nothing to gain: plain text lays out the same way
    // either way, and the container path also accepts children this one cannot.
    let Some(segments) = segments.filter(|segments| {
        segments
            .iter()
            .any(|segment| segment.style.is_some() || segment.clickable)
    }) else {
        return finish(container(node, tree), node);
    };

    let mut combined = String::new();
    let mut highlights = Vec::new();
    let mut families = Vec::new();
    let mut clickable = Vec::new();
    let mut targets = Vec::new();
    for segment in &segments {
        let from = combined.len();
        combined.push_str(&segment.text);
        let range = from..combined.len();
        if range.is_empty() {
            continue;
        }
        if let Some(style) = &segment.style {
            let highlight = style::highlight(style);
            if highlight != HighlightStyle::default() {
                highlights.push((range.clone(), highlight));
            }
            // The family is not part of a highlight; gpui resolves it in a
            // separate pass so it can be applied over the inherited style.
            if let Some(family) = &style.font_family {
                families.push((range.clone(), SharedString::from(family.clone())));
            }
        }
        if let (true, Some(span)) = (segment.clickable, segment.span) {
            clickable.push(range);
            targets.push(span);
        }
    }

    let mut styled = StyledText::new(combined);
    if !highlights.is_empty() {
        // `with_highlights` rather than `with_default_highlights`: the runs are
        // resolved at layout, over whatever text style the element inherits,
        // so a `<span>` only overrides the fields it actually names.
        styled = styled.with_highlights(highlights);
    }
    if !families.is_empty() {
        styled = styled.with_font_family_overrides(families);
    }

    let content = if clickable.is_empty() {
        styled.into_any_element()
    } else {
        InteractiveText::new(
            gpui::ElementId::NamedInteger(SharedString::new_static("runs"), node.id),
            styled,
        )
        .on_click(clickable, move |index, _window, _cx| {
            if let Some(target) = targets.get(index) {
                // gpui reports which run was clicked and nothing else, so the
                // span's listener is called without a pointer event.
                crate::emit_event(*target, "click", Value::Null);
            }
        })
        .into_any_element()
    };

    finish(shell(node, tree).child(content), node)
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
