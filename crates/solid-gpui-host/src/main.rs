//! The gpui host for `solid-gpui`.
//!
//! macOS requires the platform event loop to own the main thread, so the host —
//! not Node — is the process that runs it. A background thread reads batches of
//! operations from stdin and hands them to a foreground task, which applies them
//! to the mirrored tree and marks the root entity dirty. Everything that flows
//! back to JavaScript is a single JSON line on stdout.

mod protocol;
mod render;
mod style;
mod tree;

use std::cell::RefCell;
use std::io::{BufRead, Write};
use std::rc::Rc;
use std::sync::{Mutex, OnceLock};

use gpui::{
    App, Bounds, Context, Entity, FocusHandle, InteractiveElement, IntoElement, KeyDownEvent,
    KeyUpEvent, ParentElement, Render, Styled, TitlebarOptions, Window, WindowBackgroundAppearance,
    WindowBounds, WindowOptions, div, point, px, size,
};
use gpui_platform::application;
use serde_json::Value;

use protocol::{NodeId, Op, Outgoing, WindowConfig};
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

pub fn emit_error(message: String) {
    emit(&Outgoing::Error { m: message });
}

/// The single gpui entity backing the window. Everything below it is rebuilt
/// from the mirrored tree on each repaint.
struct Root {
    tree: Rc<RefCell<Tree>>,
    focus: FocusHandle,
    focused_once: bool,
}

impl Root {
    fn new(tree: Rc<RefCell<Tree>>, cx: &mut App) -> Self {
        Self {
            tree,
            focus: cx.focus_handle(),
            focused_once: false,
        }
    }
}

impl Render for Root {
    fn render(&mut self, window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        if !self.focused_once {
            // The root owns keyboard focus so that key listeners anywhere in the
            // tree receive events; gpui only delivers them along the focus path.
            self.focused_once = true;
            window.focus(&self.focus);
        }

        let tree = self.tree.borrow();
        let content = tree.root.map(|id| render::build(&tree, id));

        let down_tree = self.tree.clone();
        let up_tree = self.tree.clone();
        div()
            .track_focus(&self.focus)
            .size(gpui::relative(1.))
            .on_key_down(move |event: &KeyDownEvent, _window, _cx| {
                let payload = render::key_payload(event);
                let mut ids = Vec::new();
                render::dispatch_key(&down_tree.borrow(), "keyDown", &payload, &mut ids);
            })
            .on_key_up(move |event: &KeyUpEvent, _window, _cx| {
                let payload = render::keystroke_json(&event.keystroke, false);
                let mut ids = Vec::new();
                render::dispatch_key(&up_tree.borrow(), "keyUp", &payload, &mut ids);
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
            appears_transparent: false,
            traffic_light_position: None,
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
    tree: &Rc<RefCell<Tree>>,
    root: &Rc<RefCell<Option<Entity<Root>>>>,
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
        quit |= tree.borrow_mut().apply(op);
    }

    let dirty = std::mem::replace(&mut tree.borrow_mut().dirty, false);
    if dirty {
        if let Some(entity) = root.borrow().clone() {
            entity.update(cx, |_, cx| cx.notify());
        }
    }
    quit
}

fn main() {
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
        let tree = Rc::new(RefCell::new(Tree::default()));
        let root: Rc<RefCell<Option<Entity<Root>>>> = Rc::new(RefCell::new(None));

        cx.spawn(async move |cx| {
            while let Ok(batch) = receiver.recv().await {
                let quit = cx.update(|cx| apply_batch(&tree, &root, batch, cx));
                if quit {
                    break;
                }
            }
            cx.update(|cx| cx.quit());
        })
        .detach();
    });
}
