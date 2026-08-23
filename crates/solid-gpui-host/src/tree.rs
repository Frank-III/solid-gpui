//! The host-side mirror of the JavaScript shadow tree.
//!
//! Solid has already reconciled the tree by the time operations arrive, so this
//! module only applies them. Styles are parsed once, when the property is set,
//! rather than on every frame: `render` runs on every repaint and must stay
//! cheap.

use std::collections::{HashMap, HashSet};

use gpui::{ElementId, SharedString, StyleRefinement};
use serde_json::Value;

use crate::protocol::{NodeId, Op};
use crate::style::{self, WireStyle};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Element,
    Text,
}

#[derive(Debug)]
pub struct Node {
    pub id: NodeId,
    pub kind: NodeKind,
    pub tag: String,
    pub text: SharedString,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub props: HashMap<String, Value>,
    pub style: StyleRefinement,
    pub hover_style: Option<StyleRefinement>,
    pub active_style: Option<StyleRefinement>,
    pub group_hover_style: Option<StyleRefinement>,
    pub listeners: HashSet<String>,
    pub element_id: ElementId,
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
            style: StyleRefinement::default(),
            hover_style: None,
            active_style: None,
            group_hover_style: None,
            listeners: HashSet::new(),
            element_id: ElementId::Integer(id),
        }
    }

    pub fn prop_str(&self, key: &str) -> Option<&str> {
        self.props.get(key).and_then(Value::as_str)
    }

    pub fn prop_bool(&self, key: &str) -> bool {
        self.props.get(key).and_then(Value::as_bool).unwrap_or(false)
    }

    pub fn listens_to(&self, event: &str) -> bool {
        self.listeners.contains(event)
    }
}

#[derive(Debug, Default)]
pub struct Tree {
    nodes: HashMap<NodeId, Node>,
    pub root: Option<NodeId>,
    /// Set whenever an operation changed anything the next frame would paint.
    pub dirty: bool,
}

fn parse_style(value: &Value) -> Option<StyleRefinement> {
    if value.is_null() {
        return None;
    }
    match serde_json::from_value::<WireStyle>(value.clone()) {
        Ok(wire) => {
            let mut refinement = StyleRefinement::default();
            style::apply(&wire, &mut refinement);
            Some(refinement)
        }
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

    fn set_prop(&mut self, id: NodeId, key: &str, value: Value) {
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

        let parsed = match key {
            "style" | "hoverStyle" | "activeStyle" | "groupHoverStyle" => Some(parse_style(&value)),
            _ => None,
        };
        let Some(node) = self.nodes.get_mut(&id) else {
            return;
        };
        match (key, parsed) {
            ("style", Some(parsed)) => node.style = parsed.unwrap_or_default(),
            ("hoverStyle", Some(parsed)) => node.hover_style = parsed,
            ("activeStyle", Some(parsed)) => node.active_style = parsed,
            ("groupHoverStyle", Some(parsed)) => node.group_hover_style = parsed,
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
        if let Some(node) = self.nodes.get_mut(&child) {
            if node.parent == Some(parent) {
                node.parent = None;
            }
        }
    }

    /// Applies one operation. Returns `true` when the caller should quit.
    pub fn apply(&mut self, op: Op) -> bool {
        self.dirty = true;
        match op {
            Op::CreateElement { id, tag, props } => {
                self.nodes
                    .insert(id, Node::new(id, NodeKind::Element, tag, SharedString::default()));
                for (key, value) in props {
                    self.set_prop(id, &key, value);
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
            Op::SetProp { id, key, value } => self.set_prop(id, &key, value),
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
