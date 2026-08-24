//! Key bindings declared by elements.
//!
//! gpui matches a keystroke against a keymap, resolves it to an action, and
//! dispatches that action along the focus path. Everything in that sentence is
//! static in a normal gpui application: the actions are types, and the keymap is
//! loaded once. Here they arrive from JavaScript at any moment, so both are
//! rebuilt as the tree changes.
//!
//! One action type carries the whole scheme. `Bound` names the node that asked
//! for the binding and which of its bindings fired, which is enough to send the
//! keystroke back to the closure that is waiting for it.

use gpui::{App, KeyBinding, Keystroke};

use crate::protocol::NodeId;
use crate::tree::Tree;

/// The action every declared binding resolves to.
#[derive(Clone, PartialEq, Debug, gpui::Action)]
#[action(namespace = solid_gpui, no_json)]
pub struct Bound {
    pub node: NodeId,
    pub index: usize,
}

/// The key context of a focusable element, so its bindings only match while it
/// holds focus.
pub fn context(node: NodeId) -> String {
    format!("solid-gpui-{node}")
}

/// Whether gpui can parse the keystroke. `KeyBinding::new` panics on one it
/// cannot, and these strings come from an application that may have typos in it.
pub fn parses(keystrokes: &str) -> bool {
    !keystrokes.is_empty()
        && keystrokes
            .split_whitespace()
            .all(|stroke| Keystroke::parse(stroke).is_ok())
}

/// Rebuilds the whole keymap from the tree.
///
/// gpui can add bindings but not remove one, so a change anywhere means
/// clearing the map and laying it out again. That is affordable because it
/// happens when a `keys` prop changes, not per frame.
pub fn rebuild(tree: &Tree, cx: &mut App) {
    cx.clear_key_bindings();
    let mut bindings = crate::input::key_bindings();
    // A menu item's shortcut is a binding like any other, and having it in the
    // keymap is also how the platform knows what to print beside the item.
    bindings.extend(crate::menu::bindings(tree));

    for node in tree.nodes() {
        for (index, keystrokes) in node.keys.iter().enumerate() {
            if !parses(keystrokes) {
                crate::emit_error(format!("ignoring unparsable key binding {keystrokes:?}"));
                continue;
            }
            // A focusable element scopes its bindings to itself; anything else
            // is asking for an application-wide shortcut, which is the same
            // rule `onKeyDown` already follows.
            let scope = node.is_focusable().then(|| context(node.id));
            bindings.push(KeyBinding::new(
                keystrokes,
                Bound {
                    node: node.id,
                    index,
                },
                scope.as_deref(),
            ));
        }
    }

    cx.bind_keys(bindings);
}
