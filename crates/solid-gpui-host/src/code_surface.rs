//! Generic read-only shaped text surface.
//!
//! JavaScript owns the document, highlight spans and controlled selection. GPUI
//! owns only the platform-sensitive work: shaping visible lines, pointer hit
//! testing, selection geometry, pixel scrolling, focus and native copy.

use std::ops::Range;

use gpui::{
    App, Bounds, ClipboardItem, ContentMask, Context, CursorStyle, Element, ElementId, FontStyle,
    FontWeight, GlobalElementId, InspectorElementId, InteractiveElement, IntoElement, KeyDownEvent,
    LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement, Pixels,
    Point, Render, ScrollDelta, ScrollWheelEvent, ShapedLine, SharedString, Style, Styled, TextRun,
    UnderlineStyle, Window, div, fill, point, px, relative, size,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::protocol::NodeId;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireHighlight {
    start: usize,
    end: usize,
    color: Option<String>,
    background: Option<String>,
    font_style: Option<u8>,
}

#[derive(Clone)]
struct Highlight {
    range: Range<usize>,
    color: Option<gpui::Hsla>,
    background: Option<gpui::Hsla>,
    font_style: u8,
}

#[derive(Clone)]
struct LayoutLine {
    index: usize,
    range: Range<usize>,
    shaped: ShapedLine,
    number: Option<ShapedLine>,
    origin: Point<Pixels>,
}

pub struct NativeCodeSurface {
    node_id: NodeId,
    focus: gpui::FocusHandle,
    content: SharedString,
    lines: Vec<Range<usize>>,
    highlights: Vec<Highlight>,
    highlights_wire: Value,
    anchor: usize,
    head: usize,
    dragging: bool,
    line_numbers: bool,
    scroll: Point<Pixels>,
    pending_scroll_line: Option<usize>,
    last_scroll_line: Option<usize>,
    last_bounds: Option<Bounds<Pixels>>,
    last_lines: Vec<LayoutLine>,
    line_height: Pixels,
    gutter_width: Pixels,
    content_size: gpui::Size<Pixels>,
}

fn line_ranges(text: &str) -> Vec<Range<usize>> {
    let mut result = Vec::new();
    let mut start = 0;
    for (offset, ch) in text.char_indices() {
        if ch == '\n' {
            result.push(start..offset);
            start = offset + 1;
        }
    }
    result.push(start..text.len());
    result
}

fn parse_color(value: &str) -> Option<gpui::Hsla> {
    let hex = value.strip_prefix('#')?;
    match hex.len() {
        6 => u32::from_str_radix(hex, 16)
            .ok()
            .map(|value| gpui::rgb(value).into()),
        8 => u32::from_str_radix(hex, 16)
            .ok()
            .map(|value| gpui::rgba(value).into()),
        _ => None,
    }
}

fn offset_from_utf16(text: &str, offset: usize) -> usize {
    text.chars()
        .scan((0usize, 0usize), |(utf8, utf16), ch| {
            let current = (*utf8, *utf16);
            *utf8 += ch.len_utf8();
            *utf16 += ch.len_utf16();
            Some(current)
        })
        .find_map(|(utf8, utf16)| (utf16 >= offset).then_some(utf8))
        .unwrap_or(text.len())
}

fn offset_to_utf16(text: &str, offset: usize) -> usize {
    text[..offset.min(text.len())].encode_utf16().count()
}

impl NativeCodeSurface {
    pub fn new(node_id: NodeId, focus: gpui::FocusHandle) -> Self {
        Self {
            node_id,
            focus,
            content: SharedString::default(),
            lines: vec![0..0],
            highlights: Vec::new(),
            highlights_wire: Value::Null,
            anchor: 0,
            head: 0,
            dragging: false,
            line_numbers: false,
            scroll: point(px(0.), px(0.)),
            pending_scroll_line: None,
            last_scroll_line: None,
            last_bounds: None,
            last_lines: Vec::new(),
            line_height: px(16.),
            gutter_width: px(0.),
            content_size: size(px(0.), px(0.)),
        }
    }

    pub fn sync(
        &mut self,
        value: &str,
        selection: Option<(usize, usize)>,
        highlights: &Value,
        line_numbers: bool,
        scroll_to_line: Option<usize>,
    ) {
        if self.content.as_ref() != value {
            self.content = SharedString::from(value.to_owned());
            self.lines = line_ranges(value);
            self.anchor = self.anchor.min(value.len());
            self.head = self.head.min(value.len());
            self.scroll = point(px(0.), px(0.));
        }
        self.line_numbers = line_numbers;
        if let Some((start, end)) = selection {
            let start = offset_from_utf16(value, start);
            let end = offset_from_utf16(value, end);
            let current = self.anchor.min(self.head)..self.anchor.max(self.head);
            if current != (start.min(end)..start.max(end)) {
                self.anchor = start;
                self.head = end;
            }
        }
        if &self.highlights_wire != highlights {
            self.highlights_wire = highlights.clone();
            self.highlights = serde_json::from_value::<Vec<WireHighlight>>(highlights.clone())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|item| {
                    let start = offset_from_utf16(value, item.start);
                    let end = offset_from_utf16(value, item.end);
                    (end > start).then_some(Highlight {
                        range: start..end,
                        color: item.color.as_deref().and_then(parse_color),
                        background: item.background.as_deref().and_then(parse_color),
                        font_style: item.font_style.unwrap_or(0),
                    })
                })
                .collect();
            self.highlights.sort_by_key(|item| item.range.start);
        }
        if scroll_to_line != self.last_scroll_line {
            self.last_scroll_line = scroll_to_line;
            self.pending_scroll_line = scroll_to_line;
        }
    }

    fn selected_range(&self) -> Range<usize> {
        self.anchor.min(self.head)..self.anchor.max(self.head)
    }

    fn emit_selection(&self) {
        let range = self.selected_range();
        crate::emit_event(
            self.node_id,
            "selectionChange",
            json!({
                "selectionStart": offset_to_utf16(&self.content, range.start),
                "selectionEnd": offset_to_utf16(&self.content, range.end),
            }),
        );
    }

    fn hit_test(&self, position: Point<Pixels>) -> Option<(usize, usize, bool)> {
        let bounds = self.last_bounds?;
        let y = position.y - bounds.top() + self.scroll.y;
        let row = ((f32::from(y) / f32::from(self.line_height)).floor().max(0.)) as usize;
        let row = row.min(self.lines.len().saturating_sub(1));
        let range = self.lines.get(row)?.clone();
        let gutter = self.line_numbers && position.x < bounds.left() + self.gutter_width;
        if gutter {
            return Some((range.start, row, true));
        }
        let layout = self.last_lines.iter().find(|line| line.index == row)?;
        let x = position.x - bounds.left() - self.gutter_width + self.scroll.x;
        let relative = layout.shaped.closest_index_for_x(x.max(px(0.)));
        Some((range.start + relative.min(range.len()), row, false))
    }

    fn line_selection(&self, row: usize) -> Range<usize> {
        let mut range = self.lines.get(row).cloned().unwrap_or(0..0);
        if range.is_empty() && range.end < self.content.len() {
            range.end += 1;
        }
        range
    }

    fn word_selection(&self, offset: usize) -> Range<usize> {
        let text = self.content.as_ref();
        let is_word = |ch: char| ch.is_alphanumeric() || ch == '_';
        let mut start = offset.min(text.len());
        while start > 0 {
            let Some((previous, ch)) = text[..start].char_indices().next_back() else {
                break;
            };
            if !is_word(ch) {
                break;
            }
            start = previous;
        }
        let mut end = offset.min(text.len());
        while end < text.len() {
            let Some(ch) = text[end..].chars().next() else {
                break;
            };
            if !is_word(ch) {
                break;
            }
            end += ch.len_utf8();
        }
        start..end
    }

    fn mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if event.button != MouseButton::Left {
            return;
        }
        window.focus(&self.focus, cx);
        let Some((offset, row, gutter)) = self.hit_test(event.position) else {
            return;
        };
        if gutter || event.click_count >= 3 {
            let range = self.line_selection(row);
            self.anchor = range.start;
            self.head = range.end;
            self.dragging = false;
        } else if event.click_count == 2 {
            let range = self.word_selection(offset);
            self.anchor = range.start;
            self.head = range.end;
            self.dragging = false;
        } else {
            if !event.modifiers.shift {
                self.anchor = offset;
            }
            self.head = offset;
            self.dragging = true;
        }
        self.emit_selection();
        cx.notify();
    }

    fn mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.dragging || event.pressed_button != Some(MouseButton::Left) {
            return;
        }
        self.drag_to(event.position, cx);
    }

    fn drag_to(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        if let Some((offset, _, _)) = self.hit_test(position) {
            if self.head != offset {
                self.head = offset;
                self.emit_selection();
                cx.notify();
            }
        }
    }

    fn mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.dragging = false;
    }

    fn key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let shortcut = event.keystroke.modifiers.platform || event.keystroke.modifiers.control;
        if shortcut && event.keystroke.key == "c" {
            let range = self.selected_range();
            if !range.is_empty() {
                cx.write_to_clipboard(ClipboardItem::new_string(self.content[range].to_string()));
                cx.stop_propagation();
            }
        }
    }

    fn scroll_wheel(&mut self, event: &ScrollWheelEvent, _: &mut Window, cx: &mut Context<Self>) {
        let delta = match event.delta {
            ScrollDelta::Pixels(value) => value,
            ScrollDelta::Lines(value) => {
                point(value.x * self.line_height, value.y * self.line_height * 3.)
            }
        };
        let delta = if event.modifiers.shift && delta.x == px(0.) {
            point(delta.y, px(0.))
        } else {
            delta
        };
        let Some(bounds) = self.last_bounds else {
            return;
        };
        let maximum = point(
            (self.content_size.width - bounds.size.width).max(px(0.)),
            (self.content_size.height - bounds.size.height).max(px(0.)),
        );
        self.scroll.x = (self.scroll.x - delta.x).max(px(0.)).min(maximum.x);
        self.scroll.y = (self.scroll.y - delta.y).max(px(0.)).min(maximum.y);
        cx.stop_propagation();
        cx.notify();
    }
}

struct CodeElement {
    surface: gpui::Entity<NativeCodeSurface>,
}

struct Prepaint {
    lines: Vec<LayoutLine>,
    selection: Range<usize>,
    line_height: Pixels,
    gutter_width: Pixels,
    content_size: gpui::Size<Pixels>,
}

impl IntoElement for CodeElement {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

fn runs_for_line(
    content: &str,
    range: &Range<usize>,
    highlights: &[Highlight],
    style: &gpui::TextStyle,
) -> Vec<TextRun> {
    let mut runs = Vec::new();
    let mut cursor = range.start;
    for highlight in highlights
        .iter()
        .filter(|item| item.range.end > range.start && item.range.start < range.end)
    {
        let start = highlight.range.start.max(range.start).max(cursor);
        let end = highlight.range.end.min(range.end);
        if start > cursor {
            runs.push(style.to_run(start - cursor));
        }
        if end > start {
            let mut run = style.to_run(end - start);
            if let Some(color) = highlight.color {
                run.color = color;
            }
            run.background_color = highlight.background;
            if highlight.font_style & 1 != 0 {
                run.font.style = FontStyle::Italic;
            }
            if highlight.font_style & 2 != 0 {
                run.font.weight = FontWeight::BOLD;
            }
            if highlight.font_style & 4 != 0 {
                run.underline = Some(UnderlineStyle {
                    thickness: px(1.),
                    color: Some(run.color),
                    wavy: false,
                });
            }
            runs.push(run);
            cursor = end;
        }
    }
    if cursor < range.end {
        runs.push(style.to_run(range.end - cursor));
    }
    if content[range.clone()].is_empty() {
        Vec::new()
    } else {
        runs
    }
}

impl Element for CodeElement {
    type RequestLayoutState = ();
    type PrepaintState = Prepaint;

    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = relative(1.).into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Prepaint {
        let text_style = window.text_style();
        let line_height = text_style
            .line_height_in_pixels(window.rem_size())
            .max(px(1.));
        self.surface.update(cx, |surface, _| {
            if let Some(row) = surface.pending_scroll_line.take() {
                let target = px(row as f32 * f32::from(line_height)) - bounds.size.height / 2.;
                surface.scroll.y = target.max(px(0.));
            }
        });
        let surface = self.surface.read(cx);
        let content = surface.content.as_ref();
        let digits = surface.lines.len().max(1).to_string().len() as f32;
        let gutter_width = if surface.line_numbers {
            px(18. + digits * 7.)
        } else {
            px(0.)
        };
        let longest = surface
            .lines
            .iter()
            .max_by_key(|range| range.len())
            .cloned()
            .unwrap_or(0..0);
        let longest_text = SharedString::from(content[longest.clone()].to_owned());
        let longest_runs = runs_for_line(content, &longest, &surface.highlights, &text_style);
        let longest_line = window.text_system().shape_line(
            longest_text,
            text_style.font_size.to_pixels(window.rem_size()),
            &longest_runs,
            None,
        );
        let content_size = size(
            gutter_width + longest_line.width() + px(16.),
            px(surface.lines.len() as f32 * f32::from(line_height)),
        );
        let maximum_x = (content_size.width - bounds.size.width).max(px(0.));
        let maximum_y = (content_size.height - bounds.size.height).max(px(0.));
        let scroll = point(
            surface.scroll.x.min(maximum_x),
            surface.scroll.y.min(maximum_y),
        );
        let first = ((f32::from(scroll.y) / f32::from(line_height)).floor() as usize)
            .min(surface.lines.len().saturating_sub(1));
        let count = (f32::from(bounds.size.height) / f32::from(line_height)).ceil() as usize + 2;
        let last = (first + count).min(surface.lines.len());
        let mut lines = Vec::with_capacity(last.saturating_sub(first));
        for index in first..last {
            let range = surface.lines[index].clone();
            let text = SharedString::from(content[range.clone()].to_owned());
            let runs = runs_for_line(content, &range, &surface.highlights, &text_style);
            let shaped = window.text_system().shape_line(
                text,
                text_style.font_size.to_pixels(window.rem_size()),
                &runs,
                None,
            );
            let number = surface.line_numbers.then(|| {
                let value =
                    SharedString::from(format!("{:>width$}", index + 1, width = digits as usize));
                let mut run = text_style.to_run(value.len());
                run.color = gpui::rgba(0x7f8490b3).into();
                window.text_system().shape_line(
                    value,
                    text_style.font_size.to_pixels(window.rem_size()),
                    &[run],
                    None,
                )
            });
            lines.push(LayoutLine {
                index,
                range,
                shaped,
                number,
                origin: point(
                    bounds.left() + gutter_width - scroll.x,
                    bounds.top() + px(index as f32 * f32::from(line_height)) - scroll.y,
                ),
            });
        }
        Prepaint {
            lines,
            selection: surface.selected_range(),
            line_height,
            gutter_width,
            content_size,
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        prepaint: &mut Prepaint,
        window: &mut Window,
        cx: &mut App,
    ) {
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            for line in &prepaint.lines {
                if let Some(number) = &line.number {
                    let _ = number.paint(
                        point(bounds.left() + px(6.), line.origin.y),
                        prepaint.line_height,
                        gpui::TextAlign::Left,
                        None,
                        window,
                        cx,
                    );
                }
                let _ = line.shaped.paint(
                    line.origin,
                    prepaint.line_height,
                    gpui::TextAlign::Left,
                    None,
                    window,
                    cx,
                );
                let start = prepaint.selection.start.max(line.range.start);
                let end = prepaint.selection.end.min(line.range.end);
                if end > start {
                    let left = line.origin.x + line.shaped.x_for_index(start - line.range.start);
                    let right = line.origin.x + line.shaped.x_for_index(end - line.range.start);
                    window.paint_quad(fill(
                        Bounds::new(
                            point(left, line.origin.y),
                            size((right - left).max(px(1.)), prepaint.line_height),
                        ),
                        gpui::rgba(0x3b82f680),
                    ));
                }
            }
        });
        if self.surface.read(cx).dragging {
            let surface = self.surface.clone();
            window.on_mouse_event(move |event: &MouseMoveEvent, phase, _window, cx| {
                if phase == gpui::DispatchPhase::Bubble
                    && event.pressed_button == Some(MouseButton::Left)
                {
                    surface.update(cx, |surface, cx| surface.drag_to(event.position, cx));
                }
            });
            let surface = self.surface.clone();
            window.on_mouse_event(move |_event: &MouseUpEvent, phase, _window, cx| {
                if phase == gpui::DispatchPhase::Bubble {
                    surface.update(cx, |surface, _| surface.dragging = false);
                }
            });
        }
        self.surface.update(cx, |surface, _| {
            surface.last_bounds = Some(bounds);
            surface.last_lines = prepaint.lines.clone();
            surface.line_height = prepaint.line_height;
            surface.gutter_width = prepaint.gutter_width;
            surface.content_size = prepaint.content_size;
            surface.scroll.x = surface
                .scroll
                .x
                .min((prepaint.content_size.width - bounds.size.width).max(px(0.)));
            surface.scroll.y = surface
                .scroll
                .y
                .min((prepaint.content_size.height - bounds.size.height).max(px(0.)));
        });
    }
}

impl Render for NativeCodeSurface {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .track_focus(&self.focus)
            .cursor(CursorStyle::IBeam)
            .on_key_down(cx.listener(Self::key_down))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_move(cx.listener(Self::mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_scroll_wheel(cx.listener(Self::scroll_wheel))
            .child(CodeElement {
                surface: cx.entity(),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_include_empty_and_trailing_rows() {
        assert_eq!(line_ranges("a\n\n"), vec![0..1, 2..2, 3..3]);
    }

    #[test]
    fn utf16_offsets_round_trip_non_bmp_text() {
        let text = "a😀b";
        assert_eq!(offset_from_utf16(text, 3), 5);
        assert_eq!(offset_to_utf16(text, 5), 3);
    }
}
