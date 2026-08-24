//! The application menu bar, written as JSX.
//!
//! A menu is not part of what gets painted, so these tags render nothing. They
//! are read out of the tree instead and handed to the platform whenever they
//! change, which is why they still live in the tree at all: Solid's control flow
//! then works on menus exactly as it does on anything else.
//!
//! Choosing an item dispatches an action naming the node, the same trick the key
//! bindings use. A shortcut on an item is a real key binding to that action,
//! which is also how the platform knows what to print beside the item.

use gpui::{App, KeyBinding, Menu, MenuItem, SharedString};

use crate::protocol::NodeId;
use crate::tree::{Node, NodeKind, Tree};

/// The action a menu item dispatches when it is chosen.
#[derive(Clone, PartialEq, Debug, gpui::Action)]
#[action(namespace = solid_gpui, no_json)]
pub struct Selected {
    pub node: NodeId,
}

/// The label of an item, taken from its `label` prop or its text children.
fn label(node: &Node, tree: &Tree) -> String {
    if let Some(label) = node.prop_str("label") {
        return label.to_owned();
    }
    node.children
        .iter()
        .filter_map(|child| tree.get(*child))
        .filter(|child| child.kind == NodeKind::Text)
        .map(|child| child.text.to_string())
        .collect()
}

fn items(node: &Node, tree: &Tree) -> Vec<MenuItem> {
    let mut items = Vec::new();
    for child in &node.children {
        let Some(child) = tree.get(*child) else { continue };
        match child.tag.as_str() {
            "separator" => items.push(MenuItem::Separator),
            "menu" => items.push(MenuItem::Submenu(build(child, tree))),
            "item" => items.push(MenuItem::Action {
                name: SharedString::from(label(child, tree)),
                action: Box::new(Selected { node: child.id }),
                os_action: None,
                checked: child.prop_bool("checked"),
                disabled: child.prop_bool("disabled"),
            }),
            _ => {}
        }
    }
    items
}

fn build(node: &Node, tree: &Tree) -> Menu {
    Menu {
        name: SharedString::from(label(node, tree)),
        items: items(node, tree),
        disabled: node.prop_bool("disabled"),
    }
}

/// Every top-level `<menu>` in the tree, in the order they appear.
fn menus(tree: &Tree) -> Vec<Menu> {
    let Some(root) = tree.root else {
        return Vec::new();
    };
    let mut menus = Vec::new();
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        let Some(node) = tree.get(id) else { continue };
        if node.tag == "menu" {
            // A nested `<menu>` is a submenu, and is built with its parent.
            menus.push(build(node, tree));
            continue;
        }
        stack.extend(node.children.iter().rev().copied());
    }
    menus
}

/// The shortcuts menu items declare, as bindings the keymap can hold.
pub fn bindings(tree: &Tree) -> Vec<KeyBinding> {
    tree.nodes()
        .filter(|node| node.tag == "item")
        .filter_map(|node| {
            let keystrokes = node.prop_str("shortcut")?;
            crate::keys::parses(keystrokes).then(|| {
                KeyBinding::new(keystrokes, Selected { node: node.id }, None)
            })
        })
        .collect()
}

/// Hands the current menus to the platform.
pub fn rebuild(tree: &Tree, cx: &mut App) {
    cx.set_menus(menus(tree));
}
