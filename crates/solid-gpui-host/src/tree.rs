//! The host-side mirror of the JavaScript shadow tree.
//!
//! Solid has already reconciled the tree by the time operations arrive, so this
//! module only applies them. Styles are parsed once, when the property is set,
//! rather than on every frame: `render` runs on every repaint and must stay
//! cheap. The same goes for the pieces of gpui state a node owns — a focus
//! handle, a scroll handle, an input buffer — which are created when the
//! property that needs them arrives and then kept for the node's lifetime.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};

use gpui::{App, AppContext, ElementId, Entity, FocusHandle, ScrollHandle, SharedString};
use serde_json::Value;

use crate::input::InputState;
use crate::protocol::{NodeId, Op};
use crate::style::{WireAnimation, WireStyle};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Element,
    Text,
}

pub struct Node {
    pub id: NodeId,
    pub kind: NodeKind,
    pub tag: String,
    pub text: SharedString,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub props: HashMap<String, Value>,
    // Styles stay in their wire form and are merged into whatever the element
    // already set up for itself: `uniform_list`, for one, marks itself
    // scrollable at construction, and replacing its refinement wholesale threw
    // that away and left it without a scroll offset to read.
    pub style: Option<WireStyle>,
    // State styles stay in their wire form: gpui hands the closure a
    // `StyleRefinement` to merge into, and merging means re-running the same
    // field-by-field assignment `style::apply` already does.
    pub hover_style: Option<WireStyle>,
    pub active_style: Option<WireStyle>,
    pub group_hover_style: Option<WireStyle>,
    pub group_active_style: Option<WireStyle>,
    pub drag_over_style: Option<WireStyle>,
    pub animation: Option<WireAnimation>,
    pub listeners: HashSet<String>,
    pub element_id: ElementId,
    pub focus: Option<FocusHandle>,
    pub scroll: Option<ScrollHandle>,
    pub input: Option<Entity<InputState>>,
    /// The last row range a virtualised list asked JavaScript for, so the same
    /// request is not sent again on every frame.
    pub last_range: Cell<Option<(usize, usize)>>,
    /// Whether `autofocus` has already been honoured.
    pub focused_once: Cell<bool>,
    /// The scroll offset last reported to JavaScript.
    pub last_scroll: Cell<Option<(f32, f32)>>,
}

impl Node {
    fn new(id: NodeId, kind: NodeKind, tag: String, text: SharedString) -> Self {
        Self {
            id,
            kind,
            tag,
            text,
            parent: None,
            children: Vec::new(),
            props: HashMap::new(),
            style: None,
            hover_style: None,
            active_style: None,
            group_hover_style: None,
            group_active_style: None,
            drag_over_style: None,
            animation: None,
            listeners: HashSet::new(),
            element_id: ElementId::Integer(id),
            focus: None,
            scroll: None,
            input: None,
            last_range: Cell::new(None),
            focused_once: Cell::new(false),
            last_scroll: Cell::new(None),
        }
    }

    pub fn prop_str(&self, key: &str) -> Option<&str> {
        self.props.get(key).and_then(Value::as_str)
    }

    pub fn prop_f32(&self, key: &str) -> Option<f32> {
        self.props.get(key).and_then(Value::as_f64).map(|v| v as f32)
    }

    pub fn prop_usize(&self, key: &str) -> Option<usize> {
        self.props.get(key).and_then(Value::as_u64).map(|v| v as usize)
    }

    pub fn prop_bool(&self, key: &str) -> bool {
        self.props.get(key).and_then(Value::as_bool).unwrap_or(false)
    }

    /// The node id an element-valued prop points at.
    pub fn prop_node(&self, key: &str) -> Option<NodeId> {
        self.props.get(key)?.get("__node")?.as_u64()
    }

    pub fn listens_to(&self, event: &str) -> bool {
        self.listeners.contains(event)
    }

    pub fn is_focusable(&self) -> bool {
        self.focus.is_some()
    }
}

#[derive(Default)]
pub struct Tree {
    nodes: HashMap<NodeId, Node>,
    pub root: Option<NodeId>,
    /// Set whenever an operation changed anything the next frame would paint.
    pub dirty: bool,
}

fn parse_style(value: &Value) -> Option<WireStyle> {
    if value.is_null() {
        return None;
    }
    match serde_json::from_value::<WireStyle>(value.clone()) {
        Ok(wire) => Some(wire),
        Err(error) => {
            crate::emit_log(format!("ignoring unparsable style: {error}"));
            None
        }
    }
}

impl Tree {
    pub fn get(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(&id)
    }

    /// Every node that tracks its own scrolling.
    pub fn scrollables(&self) -> impl Iterator<Item = &Node> {
        self.nodes.values().filter(|node| node.scroll.is_some())
    }

    /// Every focusable node, so the window can work out what gained or lost
    /// focus between frames.
    pub fn focusables(&self) -> impl Iterator<Item = (NodeId, &FocusHandle)> {
        self.nodes
            .values()
            .filter_map(|node| node.focus.as_ref().map(|focus| (node.id, focus)))
    }

    fn ensure_focus(&mut self, id: NodeId, cx: &mut App) {
        if let Some(node) = self.nodes.get_mut(&id)
            && node.focus.is_none()
        {
            node.focus = Some(cx.focus_handle());
        }
    }

    fn set_prop(&mut self, id: NodeId, key: &str, value: Value, cx: &mut App) {
        // Listener props are encoded as `@name`; the host only needs to know
        // whether a listener exists, since the closure itself lives in JS.
        if let Some(event) = key.strip_prefix('@') {
            let Some(node) = self.nodes.get_mut(&id) else {
                return;
            };
            if value.is_null() {
                node.listeners.remove(event);
            } else {
                node.listeners.insert(event.to_string());
            }
            return;
        }

        // Anything that needs application state has to reach for it before the
        // node is mutably borrowed.
        match key {
            "focusable" | "tabIndex" | "autofocus" => self.ensure_focus(id, cx),
            "scrollTop" | "scrollLeft" => {
                if let Some(node) = self.nodes.get_mut(&id)
                    && node.scroll.is_none()
                {
                    node.scroll = Some(ScrollHandle::new());
                }
            }
            _ => {}
        }

        let parsed = match key {
            "style" | "hoverStyle" | "activeStyle" | "groupHoverStyle" | "groupActiveStyle"
            | "dragOverStyle" => Some(parse_style(&value)),
            _ => None,
        };
        let animation = (key == "animate").then(|| {
            if value.is_null() {
                None
            } else {
                serde_json::from_value::<WireAnimation>(value.clone())
                    .map_err(|error| crate::emit_log(format!("ignoring unparsable animation: {error}")))
                    .ok()
            }
        });

        let input = self.nodes.get(&id).and_then(|node| node.input.clone());
        if key == "value"
            && let Some(input) = input
        {
            let text = value.as_str().unwrap_or_default().to_owned();
            input.update(cx, |state, cx| {
                state.set_value(&text);
                cx.notify();
            });
        }
        let input = self.nodes.get(&id).and_then(|node| node.input.clone());
        if key == "placeholder"
            && let Some(input) = input
        {
            let text = value.as_str().unwrap_or_default().to_owned();
            input.update(cx, |state, cx| {
                state.placeholder = SharedString::from(text);
                cx.notify();
            });
        }

        let Some(node) = self.nodes.get_mut(&id) else {
            return;
        };
        match (key, parsed, animation) {
            ("style", Some(parsed), _) => node.style = parsed,
            ("hoverStyle", Some(parsed), _) => node.hover_style = parsed,
            ("activeStyle", Some(parsed), _) => node.active_style = parsed,
            ("groupHoverStyle", Some(parsed), _) => node.group_hover_style = parsed,
            ("groupActiveStyle", Some(parsed), _) => node.group_active_style = parsed,
            ("dragOverStyle", Some(parsed), _) => node.drag_over_style = parsed,
            ("animate", _, Some(animation)) => node.animation = animation,
            _ => {
                if value.is_null() {
                    node.props.remove(key);
                } else {
                    node.props.insert(key.to_string(), value);
                }
            }
        }
    }

    fn detach(&mut self, parent: NodeId, child: NodeId) {
        if let Some(node) = self.nodes.get_mut(&parent) {
            node.children.retain(|id| *id != child);
        }
        if let Some(node) = self.nodes.get_mut(&child)
            && node.parent == Some(parent)
        {
            node.parent = None;
        }
    }

    /// Applies one operation. Returns `true` when the caller should quit.
    pub fn apply(&mut self, op: Op, cx: &mut App) -> bool {
        self.dirty = true;
        match op {
            Op::CreateElement { id, tag, props } => {
                let is_input = tag == "input";
                self.nodes.insert(
                    id,
                    Node::new(id, NodeKind::Element, tag, SharedString::default()),
                );
                if is_input {
                    // A text field is always focusable and always owns a buffer.
                    self.ensure_focus(id, cx);
                    let focus = self
                        .nodes
                        .get(&id)
                        .and_then(|node| node.focus.clone())
                        .expect("focus handle was just created");
                    let state = cx.new(|_| InputState::new(id, focus));
                    if let Some(node) = self.nodes.get_mut(&id) {
                        node.input = Some(state);
                    }
                }
                for (key, value) in props {
                    self.set_prop(id, &key, value, cx);
                }
            }
            Op::CreateText { id, text } => {
                self.nodes.insert(
                    id,
                    Node::new(id, NodeKind::Text, String::new(), SharedString::from(text)),
                );
            }
            Op::SetText { id, text } => {
                if let Some(node) = self.nodes.get_mut(&id) {
                    node.text = SharedString::from(text);
                }
            }
            Op::SetProp { id, key, value } => self.set_prop(id, &key, value, cx),
            Op::Insert {
                parent,
                child,
                anchor,
            } => {
                if let Some(previous) = self.nodes.get(&child).and_then(|node| node.parent) {
                    self.detach(previous, child);
                }
                let index = self.nodes.get(&parent).map(|node| {
                    node.children
                        .iter()
                        .position(|id| *id == anchor)
                        .unwrap_or(node.children.len())
                });
                if let (Some(index), Some(node)) = (index, self.nodes.get_mut(&parent)) {
                    node.children.insert(index, child);
                }
                if let Some(node) = self.nodes.get_mut(&child) {
                    node.parent = Some(parent);
                }
            }
            Op::Remove { parent, child } => self.detach(parent, child),
            Op::SetRoot { id } => self.root = Some(id),
            Op::Drop { id } => {
                self.nodes.remove(&id);
            }
            Op::OpenWindow(_) => {}
            Op::Quit => return true,
        }
        false
    }
}
