//! Wire protocol shared with the JavaScript renderer.
//!
//! Everything arriving on stdin is a JSON array of operations; everything
//! written to stdout is a single JSON object. The operation encoding is
//! positional (`[opcode, ...]`) rather than a tagged object because a busy
//! frame can carry hundreds of them and the shape never varies per opcode.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type NodeId = u64;
pub type RequestId = u64;

/// A mutation requested by the JavaScript side.
#[derive(Debug)]
pub enum Op {
    CreateElement {
        id: NodeId,
        tag: String,
        props: Map<String, Value>,
    },
    CreateText {
        id: NodeId,
        text: String,
    },
    SetText {
        id: NodeId,
        text: String,
    },
    SetProp {
        id: NodeId,
        key: String,
        value: Value,
    },
    Insert {
        parent: NodeId,
        child: NodeId,
        anchor: NodeId,
    },
    Remove {
        parent: NodeId,
        child: NodeId,
    },
    SetRoot {
        id: NodeId,
    },
    OpenWindow(WindowConfig),
    Quit,
    Drop {
        id: NodeId,
    },
    /// Something the application asked the host to do that is not a tree
    /// mutation, and which is answered by request id.
    Call {
        request: RequestId,
        name: String,
        args: Value,
    },
}

/// Window options as the JavaScript side spells them.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowConfig {
    pub title: Option<String>,
    pub width: Option<f32>,
    pub height: Option<f32>,
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub titlebar: Option<bool>,
    pub titlebar_transparent: Option<bool>,
    pub traffic_light_position: Option<WirePoint>,
    pub fullscreen: Option<bool>,
    pub resizable: Option<bool>,
    pub appearance: Option<String>,
    pub activate: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct WirePoint {
    pub x: f32,
    pub y: f32,
}

fn as_id(value: Option<&Value>, what: &str) -> Result<NodeId, String> {
    value
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("expected a node id for {what}"))
}

fn as_string(value: Option<&Value>, what: &str) -> Result<String, String> {
    match value {
        Some(Value::String(text)) => Ok(text.clone()),
        Some(other) => Ok(other.to_string()),
        None => Err(format!("expected a string for {what}")),
    }
}

impl Op {
    /// Decodes one positional operation. Returns a message rather than panicking
    /// so a malformed frame can be reported and skipped.
    pub fn parse(value: &Value) -> Result<Self, String> {
        let parts = value.as_array().ok_or("operation is not an array")?;
        let code = parts
            .first()
            .and_then(Value::as_u64)
            .ok_or("operation is missing its opcode")?;
        match code {
            0 => Ok(Op::CreateElement {
                id: as_id(parts.get(1), "createElement")?,
                tag: as_string(parts.get(2), "tag")?,
                props: parts
                    .get(3)
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default(),
            }),
            1 => Ok(Op::CreateText {
                id: as_id(parts.get(1), "createText")?,
                text: as_string(parts.get(2), "text")?,
            }),
            2 => Ok(Op::SetText {
                id: as_id(parts.get(1), "setText")?,
                text: as_string(parts.get(2), "text")?,
            }),
            3 => Ok(Op::SetProp {
                id: as_id(parts.get(1), "setProp")?,
                key: as_string(parts.get(2), "property name")?,
                value: parts.get(3).cloned().unwrap_or(Value::Null),
            }),
            4 => Ok(Op::Insert {
                parent: as_id(parts.get(1), "insert parent")?,
                child: as_id(parts.get(2), "insert child")?,
                anchor: parts.get(3).and_then(Value::as_u64).unwrap_or(0),
            }),
            5 => Ok(Op::Remove {
                parent: as_id(parts.get(1), "remove parent")?,
                child: as_id(parts.get(2), "remove child")?,
            }),
            6 => Ok(Op::SetRoot {
                id: as_id(parts.get(1), "setRoot")?,
            }),
            7 => {
                let config = parts.get(1).cloned().unwrap_or(Value::Null);
                Ok(Op::OpenWindow(
                    serde_json::from_value(config).map_err(|error| error.to_string())?,
                ))
            }
            8 => Ok(Op::Quit),
            9 => Ok(Op::Drop {
                id: as_id(parts.get(1), "drop")?,
            }),
            10 => Ok(Op::Call {
                request: as_id(parts.get(1), "call")?,
                name: as_string(parts.get(2), "command name")?,
                args: parts.get(3).cloned().unwrap_or(Value::Null),
            }),
            other => Err(format!("unknown opcode {other}")),
        }
    }

    /// Decodes one line: a JSON array of operations.
    pub fn parse_batch(line: &str) -> Result<Vec<Self>, String> {
        let value: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
        let items = value.as_array().ok_or("batch is not an array")?;
        items.iter().map(Op::parse).collect()
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "t")]
pub enum Outgoing {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "e")]
    Event {
        id: NodeId,
        n: &'static str,
        d: Value,
    },
    #[serde(rename = "closed")]
    Closed,
    #[serde(rename = "log")]
    Log { m: String },
    #[serde(rename = "error")]
    Error { m: String },
    /// The answer to a `Call`. `e` carries the reason when it failed.
    #[serde(rename = "r")]
    Answer {
        i: RequestId,
        #[serde(skip_serializing_if = "Option::is_none")]
        d: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        e: Option<String>,
    },
}
