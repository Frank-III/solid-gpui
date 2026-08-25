//! Things the application asks the host to do that are not tree mutations.
//!
//! Moving the window about is immediate. The dialogs are not: gpui hands back a
//! channel that resolves when the user answers, so the reply is sent from a task
//! rather than from here, and the request id is what ties the two together.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use gpui::{App, AppContext, ClipboardEntry, PathPromptOptions, PromptLevel, WindowHandle};
use serde_json::{Value, json};

use crate::Root;
use crate::protocol::RequestId;

fn text(args: &Value, key: &str) -> Option<String> {
    args.get(key)?.as_str().map(str::to_owned)
}

fn flag(args: &Value, key: &str, fallback: bool) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn level(args: &Value) -> PromptLevel {
    match args.get("level").and_then(Value::as_str) {
        Some("warning") => PromptLevel::Warning,
        Some("critical") => PromptLevel::Critical,
        _ => PromptLevel::Info,
    }
}

/// Runs one command and answers it, either now or when the platform does.
pub fn run(
    request: RequestId,
    name: &str,
    args: &Value,
    window: Option<WindowHandle<Root>>,
    cx: &mut App,
) {
    match name {
        "window.setTitle"
        | "window.minimize"
        | "window.zoom"
        | "window.toggleFullscreen"
        | "window.activate" => {
            let Some(window) = window else {
                crate::emit_failure(request, "no window is open".into());
                return;
            };
            let title = text(args, "title").unwrap_or_default();
            let result = window.update(cx, |_root, window, _cx| match name {
                "window.setTitle" => window.set_window_title(&title),
                "window.minimize" => window.minimize_window(),
                "window.zoom" => window.zoom_window(),
                "window.toggleFullscreen" => window.toggle_fullscreen(),
                _ => window.activate_window(),
            });
            match result {
                Ok(()) => crate::emit_answer(request, Value::Null),
                Err(error) => crate::emit_failure(request, error.to_string()),
            }
        }

        "dialog.message" => {
            let Some(window) = window else {
                crate::emit_failure(request, "no window is open".into());
                return;
            };
            let message = text(args, "message").unwrap_or_default();
            let detail = text(args, "detail");
            let answers: Vec<String> = args
                .get("answers")
                .and_then(Value::as_array)
                .map(|answers| {
                    answers
                        .iter()
                        .map(|answer| answer.as_str().unwrap_or_default().to_owned())
                        .collect()
                })
                .filter(|answers: &Vec<String>| !answers.is_empty())
                .unwrap_or_else(|| vec!["OK".to_owned()]);
            let level = level(args);

            let answers: Vec<&str> = answers.iter().map(String::as_str).collect();
            let receiver = window.update(cx, |_root, window, cx| {
                window.prompt(level, &message, detail.as_deref(), &answers, cx)
            });
            let receiver = match receiver {
                Ok(receiver) => receiver,
                Err(error) => return crate::emit_failure(request, error.to_string()),
            };
            cx.background_spawn(async move {
                match receiver.await {
                    Ok(index) => crate::emit_answer(request, json!(index)),
                    Err(error) => crate::emit_failure(request, error.to_string()),
                }
            })
            .detach();
        }

        "dialog.openFile" => {
            let receiver = cx.prompt_for_paths(PathPromptOptions {
                files: flag(args, "files", true),
                directories: flag(args, "directories", false),
                multiple: flag(args, "multiple", false),
                prompt: text(args, "prompt").map(Into::into),
            });
            cx.background_spawn(async move {
                match receiver.await {
                    Ok(Ok(paths)) => crate::emit_answer(request, json!(paths.map(strings))),
                    Ok(Err(error)) => crate::emit_failure(request, error.to_string()),
                    Err(error) => crate::emit_failure(request, error.to_string()),
                }
            })
            .detach();
        }

        "dialog.saveFile" => {
            let directory = text(args, "directory")
                .map(PathBuf::from)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            let suggested = text(args, "suggestedName");
            let receiver = cx.prompt_for_new_path(&directory, suggested.as_deref());
            cx.background_spawn(async move {
                match receiver.await {
                    Ok(Ok(path)) => crate::emit_answer(
                        request,
                        json!(path.map(|path| path.to_string_lossy().into_owned())),
                    ),
                    Ok(Err(error)) => crate::emit_failure(request, error.to_string()),
                    Err(error) => crate::emit_failure(request, error.to_string()),
                }
            })
            .detach();
        }

        "clipboard.read" => {
            let entries = cx
                .read_from_clipboard()
                .map(|item| {
                    item.into_entries()
                        .map(|entry| match entry {
                            ClipboardEntry::String(value) => {
                                json!({ "type": "text", "text": value.text })
                            }
                            ClipboardEntry::ExternalPaths(paths) => json!({
                                "type": "paths",
                                "paths": paths
                                    .paths()
                                    .iter()
                                    .map(|path| path.to_string_lossy())
                                    .collect::<Vec<_>>(),
                            }),
                            ClipboardEntry::Image(image) => json!({
                                "type": "image",
                                "mime": image.format.mime_type(),
                                "data": base64::engine::general_purpose::STANDARD
                                    .encode(image.bytes),
                            }),
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            crate::emit_answer(request, json!(entries));
        }

        "shell.revealPath" | "shell.openWithSystem" => {
            let Some(path) = text(args, "path") else {
                crate::emit_failure(request, "no path was given".into());
                return;
            };
            let path = Path::new(&path);
            match name {
                "shell.revealPath" => cx.reveal_path(path),
                _ => cx.open_with_system(path),
            }
            crate::emit_answer(request, Value::Null);
        }

        other => crate::emit_failure(request, format!("unknown command {other}")),
    }
}

fn strings(paths: Vec<PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}
