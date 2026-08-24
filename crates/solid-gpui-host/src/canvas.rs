//! The draw list a `<canvas>` carries.
//!
//! gpui rebuilds its scene every frame, and the JavaScript side cannot be asked
//! to draw while that is happening — it is a different process. So a canvas is
//! not immediate-mode: JavaScript records what to draw, sends the recording as a
//! property, and the host replays it on every repaint until a new one arrives.
//!
//! Everything here is in coordinates local to the element, so a recording keeps
//! working when the element moves.

use gpui::{App, Bounds, Hsla, Path, Pixels, Point, SharedString, TextRun, Window, fill, point, px};
use serde::Deserialize;

use crate::style::WireColor;

/// One point on a path. `cx`/`cy` make the segment leading to it a quadratic
/// curve with that control point.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Vertex {
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub cx: Option<f32>,
    #[serde(default)]
    pub cy: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "k")]
pub enum Command {
    /// A rectangle, optionally rounded and outlined. gpui draws these directly,
    /// so a chart made of bars costs no triangulation.
    #[serde(rename = "quad")]
    Quad {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        background: Option<WireColor>,
        #[serde(default)]
        radius: Option<f32>,
        #[serde(default)]
        border_width: Option<f32>,
        #[serde(default)]
        border_color: Option<WireColor>,
    },
    /// A filled polygon or curve. Strokes arrive as their outline, because gpui
    /// fills paths and does not stroke them.
    #[serde(rename = "path")]
    Path {
        points: Vec<Vertex>,
        color: WireColor,
    },
    /// A single line of text, positioned by its top-left corner.
    #[serde(rename = "text")]
    Text {
        x: f32,
        y: f32,
        text: String,
        #[serde(default)]
        font_size: Option<f32>,
        #[serde(default)]
        color: Option<WireColor>,
    },
}

fn color_or(color: Option<WireColor>, fallback: Hsla) -> Hsla {
    color.map(Into::into).unwrap_or(fallback)
}

/// Replays a recording inside the element's bounds.
pub fn paint(commands: &[Command], bounds: Bounds<Pixels>, window: &mut Window, cx: &mut App) {
    let style = window.text_style();
    let origin = bounds.origin;
    for command in commands {
        match command {
            Command::Quad {
                x,
                y,
                w,
                h,
                background,
                radius,
                border_width,
                border_color,
            } => {
                let rect = Bounds::new(
                    origin + point(px(*x), px(*y)),
                    gpui::size(px(*w), px(*h)),
                );
                let mut quad = fill(rect, color_or(*background, gpui::transparent_black()));
                if let Some(radius) = radius {
                    quad = quad.corner_radii(px(*radius));
                }
                if let Some(width) = border_width {
                    quad = quad
                        .border_widths(px(*width))
                        .border_color(color_or(*border_color, style.color));
                }
                window.paint_quad(quad);
            }
            Command::Path { points, color } => {
                let Some(first) = points.first() else { continue };
                let at = |vertex: &Vertex| origin + point(px(vertex.x), px(vertex.y));
                let mut path = Path::new(at(first));
                for vertex in &points[1..] {
                    match (vertex.cx, vertex.cy) {
                        (Some(cx), Some(cy)) => {
                            path.curve_to(at(vertex), origin + point(px(cx), px(cy)))
                        }
                        _ => path.line_to(at(vertex)),
                    }
                }
                window.paint_path(path, Hsla::from(*color));
            }
            Command::Text {
                x,
                y,
                text,
                font_size,
                color,
            } => {
                let size = font_size
                    .map(px)
                    .unwrap_or_else(|| style.font_size.to_pixels(window.rem_size()));
                let text = SharedString::from(text.clone());
                let run = TextRun {
                    len: text.len(),
                    font: style.font(),
                    color: color_or(*color, style.color),
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                };
                let line = window
                    .text_system()
                    .shape_line(text, size, &[run], None);
                let at: Point<Pixels> = origin + point(px(*x), px(*y));
                let _ = line.paint(at, window.line_height(), gpui::TextAlign::Left, None, window, cx);
            }
        }
    }
}
