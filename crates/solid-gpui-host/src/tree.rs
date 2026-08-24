//! The host-side mirror of the JavaScript shadow tree.
//!
//! Solid has already reconciled the tree by the time operations arrive, so this
//! module only applies them. Styles are parsed once, when the property is set,
//! rather than on every frame: `render` runs on every repaint and must stay
//! cheap. The same goes for the pieces of gpui state a node owns — a focus
//! handle, a scroll handle, an input buffer — which are created when the
//! property that needs them arrives and then kept for the node's lifetime.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};

use gpui::{
    App, AppContext, ElementId, Entity, FocusHandle, ListState, ScrollHandle, SharedString,
    UniformListScrollHandle,
};
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
    /// How a `<scrollbar>`'s thumb is painted.
    pub thumb_style: Option<WireStyle>,
    pub animation: Option<WireAnimation>,
    pub listeners: HashSet<String>,
    /// Keystrokes this element asked to be told about, in the order they were
    /// declared. The index is what identifies one of them on the wire.
    pub keys: Vec<String>,
    pub element_id: ElementId,
    pub focus: Option<FocusHandle>,
    pub scroll: Option<ScrollHandle>,
    /// A virtualised list keeps its own scroll state, of a different type.
    pub list_scroll: Option<UniformListScrollHandle>,
    /// A `<list>` owns gpui's `ListState`, which caches every row height it has
    /// measured. It is built on the first render rather than when `count`
    /// arrives, because the props that configure it — the alignment, the
    /// overdraw — arrive in the same batch and in no particular order.
    pub list: RefCell<Option<ListState>>,
    /// The item count `list` was last told about, so a change can be turned
    /// into the splice that preserves the heights either side of it.
    pub list_count: Cell<usize>,
    /// The row window a `<list>` last built from, so rows that have just
    /// arrived can be re-measured.
    pub last_window: Cell<Option<(usize, usize)>>,
    pub input: Option<Entity<InputState>>,
    /// The last row range a virtualised list asked JavaScript for, so the same
    /// request is not sent again on every frame.
    pub last_range: Cell<Option<(usize, usize)>>,
    /// Whether `autofocus` has already been honoured.
    pub focused_once: Cell<bool>,
    /// The scroll offset last reported to JavaScript.
    pub last_scroll: Cell<Option<(f32, f32)>>,
    /// The row a virtualised list was last told to scroll to.
    pub last_scroll_to: Cell<Option<usize>>,
    /// Whether a `<list>` was last set to follow its tail.
    pub last_follow: Cell<Option<bool>>,
    /// The draw list a `<canvas>` carries, parsed once when it is set rather
    /// than on every repaint.
    pub commands: Option<Vec<crate::canvas::Command>>,
    /// The size last reported to JavaScript, for a node listening for it.
    pub last_size: Cell<Option<(f32, f32)>>,
    /// Where a drag grabbed a `<scrollbar>`'s thumb, in pixels from its leading
    /// edge. Shared with the element, which is rebuilt on every frame.
    pub grab: std::rc::Rc<Cell<Option<f32>>>,
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
            thumb_style: None,
            animation: None,
            listeners: HashSet::new(),
            keys: Vec::new(),
            element_id: ElementId::Integer(id),
            focus: None,
            scroll: None,
            list_scroll: None,
            list: RefCell::new(None),
            list_count: Cell::new(0),
            last_window: Cell::new(None),
            input: None,
            last_range: Cell::new(None),
            focused_once: Cell::new(false),
            last_scroll: Cell::new(None),
            last_scroll_to: Cell::new(None),
            last_follow: Cell::new(None),
            commands: None,
            last_size: Cell::new(None),
            grab: std::rc::Rc::new(Cell::new(None)),
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

    /// Tells a `<list>`'s state that the item count changed.
    ///
    /// Growing the list is reported as an insertion rather than a reset so the
    /// heights measured either side of it survive: a reset would drop every
    /// cached height and, with them, the scroll position. Where the items went
    /// in is the caller's to say — `insertedAt`, defaulting to the end — because
    /// a count alone cannot distinguish an append from a prepend. Shrinking is
    /// still a reset; without knowing which rows went, nothing else is safe.
    pub fn sync_list_count(&self, next: usize) {
        let state = self.list.borrow().clone();
        let Some(state) = state else {
            // Nothing to sync yet: the state is built from the current count.
            self.list_count.set(next);
            return;
        };
        let previous = self.list_count.get();
        if next == previous {
            return;
        }
        if next > previous {
            let at = self.prop_usize("insertedAt").unwrap_or(previous).min(previous);
            state.splice(at..at, next - previous);
        } else {
            state.reset(next);
        }
        self.list_count.set(next);
    }
}

#[derive(Default)]
pub struct Tree {
    nodes: HashMap<NodeId, Node>,
    pub root: Option<NodeId>,
    /// Set whenever an operation changed anything the next frame would paint.
    pub dirty: bool,
    /// Set when a `keys` prop changed, so the keymap is rebuilt once per batch
    /// rather than once per operation.
    pub keys_dirty: bool,
    /// Set when anything under a `<menu>` changed, so the platform menu bar is
    /// rebuilt once per batch.
    pub menus_dirty: bool,
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

    pub fn nodes(&self) -> impl Iterator<Item = &Node> {
        self.nodes.values()
    }

    fn is_menu(&self, id: NodeId) -> bool {
        let Some(node) = self.nodes.get(&id) else {
            return false;
        };
        let menuish = |tag: &str| matches!(tag, "menu" | "item" | "separator");
        menuish(&node.tag)
            || node
                .parent
                .and_then(|parent| self.nodes.get(&parent))
                .is_some_and(|parent| menuish(&parent.tag))
    }

    /// Notes that an operation may have changed the menu bar. The check is by
    /// tag rather than by walking the tree, so an application without menus
    /// pays nothing for having the hook here.
    fn touch_menu(&mut self, ids: [Option<NodeId>; 2]) {
        if self.menus_dirty {
            return;
        }
        self.menus_dirty = ids.into_iter().flatten().any(|id| self.is_menu(id));
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
            // Reporting the scroll offset needs a handle to read it from, and an
            // element that only listens has no other reason to own one.
            if event == "scroll"
                && !value.is_null()
                && let Some(node) = self.nodes.get_mut(&id)
                && node.scroll.is_none()
            {
                node.scroll = Some(ScrollHandle::new());
            }
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
            // An element that scrolls owns a handle whether or not anything has
            // asked about it yet, because a `<scrollbar>` pointed at it needs
            // one on the frame it first renders, and it cannot reach back and
            // add it then.
            "style" => {
                let scrolls = value
                    .get("overflow")
                    .map(|overflow| {
                        ["x", "y"].iter().any(|axis| {
                            overflow.get(axis).and_then(Value::as_str) == Some("scroll")
                        })
                    })
                    .unwrap_or(false);
                if scrolls
                    && let Some(node) = self.nodes.get_mut(&id)
                    && node.scroll.is_none()
                {
                    node.scroll = Some(ScrollHandle::new());
                }
            }
            _ => {}
        }

        let parsed = match key {
            "style" | "hoverStyle" | "activeStyle" | "groupHoverStyle" | "groupActiveStyle"
            | "dragOverStyle" | "thumbStyle" => Some(parse_style(&value)),
            _ => None,
        };
        let commands = (key == "commands").then(|| {
            if value.is_null() {
                None
            } else {
                serde_json::from_value::<Vec<crate::canvas::Command>>(value.clone())
                    .map_err(|error| {
                        crate::emit_log(format!("ignoring unparsable draw list: {error}"))
                    })
                    .ok()
            }
        });
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
        let input = self.nodes.get(&id).and_then(|node| node.input.clone());
        if (key == "multiline" || key == "rows")
            && let Some(input) = input
        {
            let multiline = key == "multiline" && value.as_bool().unwrap_or(false);
            let rows = value.as_u64().unwrap_or(0) as usize;
            input.update(cx, |state, cx| {
                match key {
                    "multiline" => state.multiline = multiline,
                    _ => state.rows = rows.max(1),
                }
                cx.notify();
            });
        }

        let Some(node) = self.nodes.get_mut(&id) else {
            return;
        };
        if let Some(commands) = commands {
            node.commands = commands;
            return;
        }
        if key == "keys" {
            node.keys = value
                .as_array()
                .map(|keys| {
                    keys.iter()
                        .map(|key| key.as_str().unwrap_or_default().to_owned())
                        .collect()
                })
                .unwrap_or_default();
            self.keys_dirty = true;
            return;
        }
        match (key, parsed, animation) {
            ("style", Some(parsed), _) => node.style = parsed,
            ("hoverStyle", Some(parsed), _) => node.hover_style = parsed,
            ("activeStyle", Some(parsed), _) => node.active_style = parsed,
            ("groupHoverStyle", Some(parsed), _) => node.group_hover_style = parsed,
            ("groupActiveStyle", Some(parsed), _) => node.group_active_style = parsed,
            ("dragOverStyle", Some(parsed), _) => node.drag_over_style = parsed,
            ("thumbStyle", Some(parsed), _) => node.thumb_style = parsed,
            ("animate", _, Some(animation)) => node.animation = animation,
            _ => {
                if value.is_null() {
                    node.props.remove(key);
                } else {
                    node.props.insert(key.to_string(), value);
                }
                if key == "count" && node.tag == "list" {
                    node.sync_list_count(node.prop_usize("count").unwrap_or(0));
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
                let tag_is_uniform_list = tag == "uniform-list";
                self.nodes.insert(
                    id,
                    Node::new(id, NodeKind::Element, tag, SharedString::default()),
                );
                if tag_is_uniform_list
                    && let Some(node) = self.nodes.get_mut(&id)
                {
                    // Same reason as above: a scrollbar has to find a handle
                    // already there.
                    node.list_scroll = Some(UniformListScrollHandle::new());
                }
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
                self.touch_menu([Some(id), None]);
            }
            Op::SetProp { id, key, value } => {
                self.set_prop(id, &key, value, cx);
                self.touch_menu([Some(id), None]);
            }
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
                self.touch_menu([Some(parent), Some(child)]);
            }
            Op::Remove { parent, child } => {
                self.touch_menu([Some(parent), Some(child)]);
                self.detach(parent, child);
            }
            Op::SetRoot { id } => self.root = Some(id),
            Op::Drop { id } => {
                self.touch_menu([Some(id), None]);
                if let Some(node) = self.nodes.remove(&id)
                    && !node.keys.is_empty()
                {
                    self.keys_dirty = true;
                }
            }
            // Both are handled before the tree sees them.
            Op::OpenWindow(_) | Op::Call { .. } => {}
            Op::Quit => return true,
        }
        false
    }
}
