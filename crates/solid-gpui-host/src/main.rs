//! The gpui host for `solid-gpui`.
//!
//! macOS requires the platform event loop to own the main thread, so the host —
//! not Node — is the process that runs it. A background thread reads batches of
//! operations from stdin and hands them to a foreground task, which applies them
//! to the mirrored tree and marks the root entity dirty. Everything that flows
//! back to JavaScript is a single JSON line on stdout.

mod canvas;
mod code_surface;
mod commands;
mod input;
mod keys;
mod menu;
mod protocol;
mod render;
mod scrollbar;
mod style;
mod tree;

use std::cell::RefCell;
use std::io::{BufRead, Write};
use std::rc::Rc;
use std::sync::{Mutex, OnceLock};

use gpui::{
    App, AppContext, Bounds, Context, Entity, ExternalPaths, FocusHandle, InteractiveElement,
    IntoElement, KeyDownEvent, KeyUpEvent, ParentElement, Render, Styled, TitlebarOptions, Window,
    WindowBackgroundAppearance, WindowBounds, WindowHandle, WindowOptions, div, point, px, size,
};
use gpui_platform::application;
use serde_json::Value;

use protocol::{NodeId, Op, Outgoing, WindowConfig};
use render::Shared;
use tree::Tree;

static STDOUT: OnceLock<Mutex<std::io::Stdout>> = OnceLock::new();

fn emit(message: &Outgoing) {
    let Ok(line) = serde_json::to_string(message) else {
        return;
    };
    let stdout = STDOUT.get_or_init(|| Mutex::new(std::io::stdout()));
    if let Ok(mut handle) = stdout.lock() {
        let _ = handle.write_all(line.as_bytes());
        let _ = handle.write_all(b"\n");
        let _ = handle.flush();
    }
}

pub fn emit_event(id: NodeId, name: &'static str, payload: Value) {
    emit(&Outgoing::Event {
        id,
        n: name,
        d: payload,
    });
}

pub fn emit_log(message: String) {
    emit(&Outgoing::Log { m: message });
}

/// Answers a `Call` that succeeded.
pub fn emit_answer(request: protocol::RequestId, value: Value) {
    emit(&Outgoing::Answer {
        i: request,
        d: Some(value),
        e: None,
    });
}

/// Answers a `Call` that failed. The application sees a rejected promise.
pub fn emit_failure(request: protocol::RequestId, message: String) {
    emit(&Outgoing::Answer {
        i: request,
        d: None,
        e: Some(message),
    });
}

pub fn emit_error(message: String) {
    emit(&Outgoing::Error { m: message });
}

/// The single gpui entity backing the window. Everything below it is rebuilt
/// from the mirrored tree on each repaint.
struct Root {
    tree: Shared,
    focus: FocusHandle,
    focused_once: bool,
    /// The node that held focus at the end of the previous frame, so focus and
    /// blur can be reported without an element-level hook, which gpui does not
    /// expose.
    focused_node: Option<NodeId>,
}

impl Root {
    fn new(tree: Shared, cx: &mut App) -> Self {
        Self {
            tree,
            focus: cx.focus_handle(),
            focused_once: false,
            focused_node: None,
        }
    }

    /// Honours one-shot `autofocus` and controlled `focused` requests.
    fn apply_autofocus(&mut self, window: &mut Window, cx: &mut App) {
        let pending: Vec<FocusHandle> = {
            let tree = self.tree.borrow();
            tree.focusables()
                .filter_map(|(id, focus)| {
                    let node = tree.get(id)?;
                    if node.prop_bool("focused")
                        || (node.prop_bool("autofocus") && !node.focused_once.get())
                    {
                        node.focused_once.set(true);
                        Some(focus.clone())
                    } else {
                        None
                    }
                })
                .collect()
        };
        if let Some(focus) = pending.into_iter().next() {
            window.focus(&focus, cx);
        }
    }

    /// Compares this frame's focus with the last one and reports the change.
    fn report_focus(&mut self, window: &mut Window, cx: &mut App) {
        let focused = window.focused(cx);
        let current = focused.as_ref().and_then(|handle| {
            let tree = self.tree.borrow();
            tree.focusables()
                .find(|(_, candidate)| *candidate == handle)
                .map(|(id, _)| id)
        });
        if current == self.focused_node {
            return;
        }
        if let Some(previous) = self.focused_node {
            // A text field reports its accumulated edit as it loses focus.
            let state = self
                .tree
                .borrow()
                .get(previous)
                .and_then(|node| node.input.clone());
            if let Some(state) = state {
                state.update(cx, |input, _| input.blurred());
            }
            if self
                .tree
                .borrow()
                .get(previous)
                .is_some_and(|node| node.listens_to("blur"))
            {
                emit_event(previous, "blur", Value::Null);
            }
        }
        if let Some(next) = current
            && self
                .tree
                .borrow()
                .get(next)
                .is_some_and(|node| node.listens_to("focus"))
        {
            emit_event(next, "focus", Value::Null);
        }
        self.focused_node = current;
    }
}

impl Render for Root {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.focused_once {
            // The root holds keyboard focus so that key listeners on elements
            // that are not themselves focusable still receive events.
            self.focused_once = true;
            window.focus(&self.focus, cx);
        }
        self.apply_autofocus(window, cx);
        self.report_focus(window, cx);
        render::report_scrolls(&self.tree.borrow());

        let root = self.tree.borrow().root;
        let content = root.map(|id| render::build(&self.tree, id));

        let down_tree = self.tree.clone();
        let up_tree = self.tree.clone();
        let drop_tree = self.tree.clone();
        div()
            .track_focus(&self.focus)
            .flex()
            .flex_col()
            .size(gpui::relative(1.))
            .on_key_down(move |event: &KeyDownEvent, _window, _cx| {
                let payload = render::key_payload(event);
                render::dispatch_key(&down_tree.borrow(), "keyDown", &payload);
            })
            .on_key_up(move |event: &KeyUpEvent, _window, _cx| {
                let payload = render::keystroke_json(&event.keystroke, false);
                render::dispatch_key(&up_tree.borrow(), "keyUp", &payload);
            })
            .on_drop(move |paths: &ExternalPaths, _window, _cx| {
                let payload = serde_json::json!({
                    "paths": paths
                        .paths()
                        .iter()
                        .map(|path| path.to_string_lossy())
                        .collect::<Vec<_>>()
                });
                for node in drop_tree
                    .borrow()
                    .nodes()
                    .filter(|node| node.listens_to("dropFiles"))
                {
                    emit_event(node.id, "dropFiles", payload.clone());
                }
            })
            .children(content)
    }
}

fn window_options(config: &WindowConfig, cx: &mut App) -> WindowOptions {
    let width = px(config.width.unwrap_or(800.));
    let height = px(config.height.unwrap_or(600.));
    let bounds = match (config.x, config.y) {
        (Some(x), Some(y)) => Bounds {
            origin: point(px(x), px(y)),
            size: size(width, height),
        },
        _ => Bounds::centered(None, size(width, height), cx),
    };

    let titlebar = if config.titlebar == Some(false) {
        None
    } else {
        Some(TitlebarOptions {
            title: config
                .title
                .clone()
                .map(Into::into)
                .or_else(|| Some("solid-gpui".into())),
            appears_transparent: config.titlebar_transparent.unwrap_or(false),
            traffic_light_position: config
                .traffic_light_position
                .map(|position| point(px(position.x), px(position.y))),
        })
    };

    let window_background = match config.appearance.as_deref() {
        Some("transparent") => WindowBackgroundAppearance::Transparent,
        Some("blurred") => WindowBackgroundAppearance::Blurred,
        _ => WindowBackgroundAppearance::Opaque,
    };

    WindowOptions {
        window_bounds: Some(if config.fullscreen == Some(true) {
            WindowBounds::Fullscreen(bounds)
        } else {
            WindowBounds::Windowed(bounds)
        }),
        titlebar,
        is_resizable: config.resizable.unwrap_or(true),
        window_background,
        ..Default::default()
    }
}

/// Applies one batch. Returns `true` when JavaScript asked the host to quit.
fn apply_batch(
    tree: &Shared,
    root: &Rc<RefCell<Option<Entity<Root>>>>,
    window: &Rc<RefCell<Option<WindowHandle<Root>>>>,
    batch: Vec<Op>,
    cx: &mut App,
) -> bool {
    let mut quit = false;
    for op in batch {
        if let Op::OpenWindow(config) = op {
            if root.borrow().is_some() {
                emit_error("a window is already open".into());
                continue;
            }
            let options = window_options(&config, cx);
            let tree_for_root = tree.clone();
            match cx.open_window(options, |_window, cx| {
                cx.new(|cx| Root::new(tree_for_root, cx))
            }) {
                Ok(handle) => {
                    *root.borrow_mut() = handle.entity(cx).ok();
                    *window.borrow_mut() = Some(handle);
                    cx.on_window_closed(|cx, _id| {
                        emit(&Outgoing::Closed);
                        cx.quit();
                    })
                    .detach();
                    if config.activate.unwrap_or(true) {
                        cx.activate(true);
                    }
                    emit(&Outgoing::Ready);
                }
                Err(error) => emit_error(format!("could not open window: {error}")),
            }
            continue;
        }
        if let Op::Call {
            request,
            name,
            args,
        } = op
        {
            let handle = *window.borrow();
            commands::run(request, &name, &args, handle, cx);
            continue;
        }
        let mut borrowed = tree.borrow_mut();
        quit |= borrowed.apply(op, cx);
    }

    // The keymap is global, so it is rebuilt once for the batch rather than once
    // for each element whose bindings changed.
    // The keymap first: the platform reads an item's shortcut out of it while
    // the menu is being built, so a menu built before the bindings exist shows
    // no shortcuts at all.
    let menus = std::mem::replace(&mut tree.borrow_mut().menus_dirty, false);
    let rebind = std::mem::replace(&mut tree.borrow_mut().keys_dirty, false) || menus;
    if rebind {
        let borrowed = tree.borrow();
        keys::rebuild(&borrowed, cx);
    }
    if menus {
        let borrowed = tree.borrow();
        menu::rebuild(&borrowed, cx);
    }

    let dirty = std::mem::replace(&mut tree.borrow_mut().dirty, false);
    if dirty && let Some(entity) = root.borrow().clone() {
        entity.update(cx, |_, cx| cx.notify());
    }
    quit
}

fn main() {
    // gpui reports real problems through `log` — a missing text system, a
    // shader that would not compile — and says nothing without a logger.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .target(env_logger::Target::Stderr)
        .init();

    let (sender, receiver) = async_channel::unbounded::<Vec<Op>>();

    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match Op::parse_batch(&line) {
                Ok(batch) => {
                    if sender.send_blocking(batch).is_err() {
                        break;
                    }
                }
                Err(error) => emit_error(format!("malformed operation batch: {error}")),
            }
        }
        // stdin reaching EOF means the JavaScript process is gone.
        sender.close();
    });

    application().run(move |cx: &mut App| {
        cx.bind_keys(input::key_bindings());

        // Every binding an element declares resolves to this one action, which
        // names the element that asked for it.
        cx.on_action(|action: &keys::Bound, _cx| {
            emit_event(
                action.node,
                "keys",
                serde_json::json!({ "index": action.index }),
            );
        });
        cx.on_action(|action: &menu::Selected, _cx| {
            emit_event(action.node, "select", Value::Null);
        });

        let tree: Shared = Rc::new(RefCell::new(Tree::default()));
        let root: Rc<RefCell<Option<Entity<Root>>>> = Rc::new(RefCell::new(None));
        let window: Rc<RefCell<Option<WindowHandle<Root>>>> = Rc::new(RefCell::new(None));

        cx.spawn(async move |cx| {
            while let Ok(batch) = receiver.recv().await {
                let quit = cx.update(|cx| apply_batch(&tree, &root, &window, batch, cx));
                if quit {
                    break;
                }
            }
            cx.update(|cx| cx.quit());
        })
        .detach();
    });
}
