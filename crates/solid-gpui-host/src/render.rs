//! Turns the mirrored tree into gpui elements.
//!
//! This runs on every repaint, so it does no parsing: styles were converted
//! when they were set, and listeners are attached as thin closures that forward
//! the event to JavaScript and return.

use gpui::{
    AnyElement, AppContext, ClickEvent, Context, Display, InteractiveElement, IntoElement,
    KeyDownEvent, MouseDownEvent, MouseExitEvent, MouseMoveEvent, MouseUpEvent, ParentElement,
    Render, ScrollDelta,
    ScrollWheelEvent, SharedString, StatefulInteractiveElement, Styled, StyleRefinement, Window,
    div, hsla, img, px, svg,
};
use serde_json::{Value, json};

use crate::protocol::NodeId;
use crate::style;
use crate::tree::{Node, NodeKind, Tree};

fn point_json(point: gpui::Point<gpui::Pixels>) -> Value {
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

fn button_name(button: gpui::MouseButton) -> &'static str {
    match button {
        gpui::MouseButton::Left => "left",
        gpui::MouseButton::Right => "right",
        gpui::MouseButton::Middle => "middle",
        gpui::MouseButton::Navigate(gpui::NavigationDirection::Back) => "navigate-back",
        gpui::MouseButton::Navigate(gpui::NavigationDirection::Forward) => "navigate-forward",
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
            .px(px(8.))
            .py(px(4.))
            .bg(hsla(0., 0., 0.12, 0.95))
            .text_color(hsla(0., 0., 0.95, 1.))
            .rounded(px(4.))
            .child(self.text.clone())
    }
}

/// Applies styles, groups, tooltips and listeners shared by every element kind.
fn decorate<E>(mut element: E, node: &Node) -> E
where
    E: Styled + StatefulInteractiveElement,
{
    *element.style() = node.style.clone();

    if let Some(group) = node.prop_str("group") {
        element = element.group(SharedString::from(group.to_owned()));
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
    if let (Some(group), Some(group_hover)) = (
        node.prop_str("groupOf").map(str::to_owned),
        node.group_hover_style.clone(),
    ) {
        element = element.group_hover(group, move |mut base: StyleRefinement| {
            style::apply(&group_hover, &mut base);
            base
        });
    }
    if let Some(tooltip) = node.prop_str("tooltip").map(str::to_owned) {
        element = element.tooltip(move |_window, cx| {
            let text = SharedString::from(tooltip.clone());
            cx.new(|_| TextTooltip { text }).into()
        });
    }

    let id = node.id;
    if node.listens_to("click") {
        element = element.on_click(move |event, _window, _cx| {
            crate::emit_event(id, "click", click_json(event));
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
        for button in [gpui::MouseButton::Left, gpui::MouseButton::Right] {
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

    element
}

/// Builds the element for one node, recursing through its children.
pub fn build(tree: &Tree, id: NodeId) -> AnyElement {
    let Some(node) = tree.get(id) else {
        return div().into_any_element();
    };

    if node.kind == NodeKind::Text {
        return div().flex().child(node.text.clone()).into_any_element();
    }

    match node.tag.as_str() {
        "img" => {
            let source = node.prop_str("src").unwrap_or_default().to_owned();
            decorate(img(source).id(node.element_id.clone()), node).into_any_element()
        }
        "svg" => {
            let path = node.prop_str("path").unwrap_or_default().to_owned();
            decorate(svg().path(SharedString::from(path)).id(node.element_id.clone()), node)
                .into_any_element()
        }
        _ => {
            let mut element = decorate(div().id(node.element_id.clone()), node);
            // gpui's `Style::default()` is `display: block`, which is why
            // hand-written gpui code calls `.flex()` on nearly every div. The
            // element model this renderer exposes is flexbox — `flexDirection`,
            // `alignItems`, `justifyContent` and `gap` are documented to work on
            // a bare `<div>` — so anything that did not ask for another display
            // gets flex. Block layout silently ignores all of those properties.
            if element.style().display.is_none() {
                element.style().display = Some(Display::Flex);
            }
            // Consecutive text nodes are concatenated: `<div>#{n}</div>` compiles
            // to two adjacent text nodes, and emitting them as two children
            // would lay them out as two boxes instead of one run of text.
            let mut run = String::new();
            for child in &node.children {
                match tree.get(*child) {
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
            element.into_any_element()
        }
    }
}

/// Reports a key event to every node that registered the matching listener.
/// gpui delivers key events along the focus path, and the tree has a single
/// focused root, so fan-out happens here rather than per element.
pub fn dispatch_key(tree: &Tree, event_name: &'static str, payload: &Value, ids: &mut Vec<NodeId>) {
    ids.clear();
    let Some(root) = tree.root else { return };
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        let Some(node) = tree.get(id) else { continue };
        if node.listens_to(event_name) {
            ids.push(id);
        }
        stack.extend(node.children.iter().copied());
    }
    for id in ids.iter() {
        crate::emit_event(*id, event_name, payload.clone());
    }
}

/// Kept for symmetry with `dispatch_key`; both take `KeyDownEvent`-shaped data.
pub fn key_payload(event: &KeyDownEvent) -> Value {
    keystroke_json(&event.keystroke, event.is_held)
}
