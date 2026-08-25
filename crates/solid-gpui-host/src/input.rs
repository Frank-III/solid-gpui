//! A text field whose buffer lives in the host.
//!
//! Text editing cannot be driven from JavaScript: the platform asks for the
//! selected range, the text around the cursor and the bounds of a character
//! synchronously while composing input, and none of those questions survive a
//! round trip over a pipe. So the host owns the buffer, the selection and the
//! marked (in-composition) range, and reports edits to JavaScript afterwards.
//!
//! From the application's side this behaves like a controlled input that never
//! stutters: `value` sets the text, `onInput` reports every edit.
//!
//! A field is one line unless `multiline` is set, in which case it wraps, grows
//! to fit what it holds, and takes newlines from the return key and the
//! clipboard. Almost everything else is shared: the difference lives in how the
//! text is shaped, and in the geometry that maps between an offset in the buffer
//! and a point on screen.

use std::ops::Range;
use std::rc::Rc;

use gpui::{
    App, Bounds, ClipboardItem, Context, Element, ElementInputHandler, Entity, EntityInputHandler,
    FocusHandle, GlobalElementId, Hsla, InspectorElementId, IntoElement, LayoutId, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, PaintQuad, Pixels, Point, SharedString, Size, Style, TextRun,
    UTF16Selection, UnderlineStyle, Window, WrappedLine, actions, fill, point, px, relative, rgba,
    size,
};
use serde_json::json;
use unicode_segmentation::UnicodeSegmentation;

use crate::protocol::NodeId;

actions!(
    solid_gpui_input,
    [
        Backspace,
        Delete,
        Left,
        Right,
        SelectLeft,
        SelectRight,
        SelectAll,
        Home,
        End,
        ShowCharacterPalette,
        Paste,
        Cut,
        Copy,
        Up,
        Down,
        SelectUp,
        SelectDown,
        Newline,
    ]
);

/// The keystrokes the field understands. Bound once, at startup.
pub fn key_bindings() -> Vec<gpui::KeyBinding> {
    let context = Some("SolidGpuiInput");
    vec![
        gpui::KeyBinding::new("backspace", Backspace, context),
        gpui::KeyBinding::new("delete", Delete, context),
        gpui::KeyBinding::new("left", Left, context),
        gpui::KeyBinding::new("right", Right, context),
        gpui::KeyBinding::new("shift-left", SelectLeft, context),
        gpui::KeyBinding::new("shift-right", SelectRight, context),
        gpui::KeyBinding::new("home", Home, context),
        gpui::KeyBinding::new("end", End, context),
        gpui::KeyBinding::new("up", Up, context),
        gpui::KeyBinding::new("down", Down, context),
        gpui::KeyBinding::new("shift-up", SelectUp, context),
        gpui::KeyBinding::new("shift-down", SelectDown, context),
        // Only a multi-line field acts on this; in a single-line one the return
        // key falls through to whatever else is listening for it.
        gpui::KeyBinding::new("enter", Newline, context),
        gpui::KeyBinding::new("cmd-a", SelectAll, context),
        gpui::KeyBinding::new("ctrl-a", SelectAll, context),
        gpui::KeyBinding::new("cmd-v", Paste, context),
        gpui::KeyBinding::new("ctrl-v", Paste, context),
        gpui::KeyBinding::new("cmd-c", Copy, context),
        gpui::KeyBinding::new("ctrl-c", Copy, context),
        gpui::KeyBinding::new("cmd-x", Cut, context),
        gpui::KeyBinding::new("ctrl-x", Cut, context),
        gpui::KeyBinding::new("ctrl-cmd-space", ShowCharacterPalette, context),
    ]
}

pub struct InputState {
    node: NodeId,
    pub focus: FocusHandle,
    pub content: SharedString,
    pub placeholder: SharedString,
    /// Wraps, grows and accepts newlines.
    pub multiline: bool,
    /// The height an empty multi-line field starts at, in lines.
    pub rows: usize,
    /// Whether plain Enter inserts a newline instead of reaching the app.
    pub newline_on_enter: bool,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    /// The shaped text of the last frame: one entry per hard line, each of
    /// which may occupy several rows once it wraps. Shared with the element
    /// that painted it, because a shaped line cannot be copied.
    last_layout: Option<Rc<Vec<WrappedLine>>>,
    last_line_height: Pixels,
    last_bounds: Option<Bounds<Pixels>>,
    is_selecting: bool,
    /// Set by an edit, cleared when `change` is reported on blur.
    edited_since_focus: bool,
}

impl InputState {
    pub fn new(node: NodeId, focus: FocusHandle) -> Self {
        Self {
            node,
            focus,
            content: SharedString::default(),
            placeholder: SharedString::default(),
            multiline: false,
            rows: 1,
            newline_on_enter: true,
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            last_layout: None,
            last_line_height: px(0.),
            last_bounds: None,
            is_selecting: false,
            edited_since_focus: false,
        }
    }

    /// Applies a `value` prop. The selection is clamped rather than reset so a
    /// controlled input that echoes what was typed does not move the cursor.
    pub fn set_value(&mut self, value: &str) {
        if self.content.as_ref() == value {
            return;
        }
        self.content = SharedString::from(value.to_owned());
        let length = self.content.len();
        self.selected_range =
            self.selected_range.start.min(length)..self.selected_range.end.min(length);
        self.marked_range = None;
    }

    /// Applies controlled selection props, expressed in JavaScript UTF-16
    /// offsets, without reporting a user edit back to the application.
    pub fn set_selection(&mut self, start: usize, end: usize) {
        let start = self.offset_from_utf16(start);
        let end = self.offset_from_utf16(end);
        self.selected_range = start.min(end)..start.max(end);
        self.selection_reversed = end < start;
    }

    fn selection_utf16(&self) -> (usize, usize) {
        let range = self.range_to_utf16(&self.selected_range);
        (range.start, range.end)
    }

    fn report(&mut self, name: &'static str) {
        let (start, end) = self.selection_utf16();
        crate::emit_event(
            self.node,
            name,
            json!({
                "value": self.content.to_string(),
                "selectionStart": start,
                "selectionEnd": end,
                "composing": self.marked_range.is_some(),
            }),
        );
    }

    fn edited(&mut self) {
        self.edited_since_focus = true;
        self.report("input");
    }

    /// Called when focus leaves the field, so `onChange` can fire once.
    pub fn blurred(&mut self) {
        if self.edited_since_focus {
            self.edited_since_focus = false;
            self.report("change");
        }
    }

    pub fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.previous_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.start, cx)
        }
    }

    pub fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.next_boundary(self.selected_range.end), cx);
        } else {
            self.move_to(self.selected_range.end, cx)
        }
    }

    pub fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    pub fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    pub fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
        self.select_to(self.content.len(), cx)
    }

    pub fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        let offset = match self.multiline {
            true => self.edge_of_row(self.cursor_offset(), false),
            false => 0,
        };
        self.move_to(offset, cx);
    }

    pub fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        let offset = match self.multiline {
            true => self.edge_of_row(self.cursor_offset(), true),
            false => self.content.len(),
        };
        self.move_to(offset, cx);
    }

    pub fn up(&mut self, _: &Up, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.offset_one_row_away(self.cursor_offset(), -1.) {
            self.move_to(offset, cx);
        }
    }

    pub fn down(&mut self, _: &Down, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.offset_one_row_away(self.cursor_offset(), 1.) {
            self.move_to(offset, cx);
        }
    }

    pub fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.offset_one_row_away(self.cursor_offset(), -1.) {
            self.select_to(offset, cx);
        }
    }

    pub fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.offset_one_row_away(self.cursor_offset(), 1.) {
            self.select_to(offset, cx);
        }
    }

    /// The return key. A single-line field, or a multiline field configured to
    /// propagate Enter, ignores it so the keystroke reaches the application.
    pub fn newline(&mut self, _: &Newline, window: &mut Window, cx: &mut Context<Self>) {
        if !self.multiline || !self.newline_on_enter {
            return;
        }
        self.replace_text_in_range(None, "\n", window, cx);
    }

    pub fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let previous = self.previous_boundary(self.cursor_offset());
            if self.cursor_offset() == previous {
                return;
            }
            self.select_to(previous, cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    pub fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let next = self.next_boundary(self.cursor_offset());
            if self.cursor_offset() == next {
                return;
            }
            self.select_to(next, cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    pub fn show_character_palette(
        &mut self,
        _: &ShowCharacterPalette,
        window: &mut Window,
        _: &mut Context<Self>,
    ) {
        window.show_character_palette();
    }

    pub fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            let text = match self.multiline {
                true => text,
                false => text.replace('\n', " "),
            };
            self.replace_text_in_range(None, &text, window, cx);
        }
    }

    pub fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.selected_range.clone()].to_string(),
            ));
        }
    }

    pub fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.selected_range.clone()].to_string(),
            ));
            self.replace_text_in_range(None, "", window, cx)
        }
    }

    pub fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.is_selecting = true;
        if event.modifiers.shift {
            self.select_to(self.index_for_mouse_position(event.position), cx);
        } else {
            self.move_to(self.index_for_mouse_position(event.position), cx)
        }
    }

    pub fn on_mouse_up(&mut self, _: &MouseUpEvent, _window: &mut Window, _: &mut Context<Self>) {
        self.is_selecting = false;
    }

    pub fn on_mouse_move(
        &mut self,
        event: &MouseMoveEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.is_selecting {
            self.select_to(self.index_for_mouse_position(event.position), cx);
        }
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.selected_range = offset..offset;
        cx.notify()
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn index_for_mouse_position(&self, position: Point<Pixels>) -> usize {
        if self.content.is_empty() {
            return 0;
        }
        let Some(bounds) = self.last_bounds.as_ref() else {
            return 0;
        };
        if position.y < bounds.top() {
            return 0;
        }
        if position.y > bounds.bottom() {
            return self.content.len();
        }
        self.offset_for_position(position - bounds.origin)
            .unwrap_or(0)
    }

    /// Where an offset in the buffer sits, relative to the field's origin.
    ///
    /// The shaped text is one entry per hard line; the newline between two of
    /// them is a byte that belongs to neither, which is why the running offset
    /// steps over one.
    fn position_for_offset(&self, offset: usize) -> Option<Point<Pixels>> {
        let lines = self.last_layout.as_ref()?;
        let line_height = self.last_line_height;
        let mut start = 0;
        let mut top = px(0.);
        for line in lines.iter() {
            let end = start + line.len();
            if offset <= end {
                let mut position = line.position_for_index(offset - start, line_height)?;
                position.y += top;
                return Some(position);
            }
            top += line.size(line_height).height;
            start = end + 1;
        }
        None
    }

    /// The offset nearest a point given relative to the field's origin.
    fn offset_for_position(&self, position: Point<Pixels>) -> Option<usize> {
        let lines = self.last_layout.as_ref()?;
        let line_height = self.last_line_height;
        let mut start = 0;
        let mut top = px(0.);
        let last = lines.len().saturating_sub(1);
        for (index, line) in lines.iter().enumerate() {
            let height = line.size(line_height).height;
            if position.y < top + height || index == last {
                let local = point(position.x, position.y - top);
                let within = line
                    .closest_index_for_position(local, line_height)
                    .unwrap_or_else(|index| index);
                return Some(start + within.min(line.len()));
            }
            top += height;
            start = start + line.len() + 1;
        }
        None
    }

    /// The offset a row above or below this one, keeping the same column.
    fn offset_one_row_away(&self, offset: usize, rows: f32) -> Option<usize> {
        if !self.multiline {
            return None;
        }
        let line_height = self.last_line_height;
        let position = self.position_for_offset(offset)?;
        self.offset_for_position(point(position.x, position.y + line_height * rows))
    }

    /// The start or the end of the row the offset is on, wrapping included.
    fn edge_of_row(&self, offset: usize, end: bool) -> usize {
        let Some(position) = self.position_for_offset(offset) else {
            return match end {
                true => self.content.len(),
                false => 0,
            };
        };
        let x = match end {
            true => px(f32::MAX),
            false => px(0.),
        };
        self.offset_for_position(point(x, position.y))
            .unwrap_or(offset)
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        if self.selection_reversed {
            self.selected_range.start = offset
        } else {
            self.selected_range.end = offset
        };
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        cx.notify()
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf8_offset = 0;
        let mut utf16_count = 0;
        for ch in self.content.chars() {
            if utf16_count >= offset {
                break;
            }
            utf16_count += ch.len_utf16();
            utf8_offset += ch.len_utf8();
        }
        utf8_offset
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let mut utf16_offset = 0;
        let mut utf8_count = 0;
        for ch in self.content.chars() {
            if utf8_count >= offset {
                break;
            }
            utf8_count += ch.len_utf8();
            utf16_offset += ch.len_utf16();
        }
        utf16_offset
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range_utf16: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(range_utf16.start)..self.offset_from_utf16(range_utf16.end)
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .rev()
            .find_map(|(index, _)| (index < offset).then_some(index))
            .unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(index, _)| (index > offset).then_some(index))
            .unwrap_or(self.content.len())
    }
}

impl EntityInputHandler for InputState {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range_utf16);
        actual_range.replace(self.range_to_utf16(&range));
        Some(self.content[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range_to_utf16(&self.selected_range),
            reversed: self.selection_reversed,
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        self.marked_range
            .as_ref()
            .map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {
        self.marked_range = None;
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());

        self.content =
            (self.content[0..range.start].to_owned() + new_text + &self.content[range.end..])
                .into();
        self.selected_range = range.start + new_text.len()..range.start + new_text.len();
        self.marked_range.take();
        self.edited();
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());

        self.content =
            (self.content[0..range.start].to_owned() + new_text + &self.content[range.end..])
                .into();
        self.marked_range = if new_text.is_empty() {
            None
        } else {
            Some(range.start..range.start + new_text.len())
        };
        self.selected_range = new_selected_range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .map(|new_range| new_range.start + range.start..new_range.end + range.end)
            .unwrap_or_else(|| range.start + new_text.len()..range.start + new_text.len());
        self.edited();
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.range_from_utf16(&range_utf16);
        let start = self.position_for_offset(range.start)?;
        let end = self.position_for_offset(range.end)?;
        // The platform wants one rectangle. A range that spans rows is reported
        // as the box around them, which is what a composition popover needs.
        Some(Bounds::from_corners(
            bounds.origin + point(start.x, start.y),
            bounds.origin + point(end.x, end.y + self.last_line_height),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        let bounds = self.last_bounds?;
        let utf8_index = self.offset_for_position(point - bounds.origin)?;
        Some(self.offset_to_utf16(utf8_index))
    }
}

/// Paints the text, the selection and the caret, and installs the platform
/// input handler for the field's bounds.
pub struct TextElement {
    pub input: Entity<InputState>,
}

pub struct TextPrepaint {
    lines: Rc<Vec<WrappedLine>>,
    cursor: Option<PaintQuad>,
    /// One rectangle per row the selection covers.
    selection: Vec<PaintQuad>,
}

/// Shapes the field's text, wrapping it when there is a width to wrap to.
///
/// Returns the shaped lines and the colour they were shaped in, which is dimmed
/// while the placeholder is showing.
fn shape(
    input: &InputState,
    wrap_width: Option<Pixels>,
    window: &mut Window,
) -> (Vec<WrappedLine>, Hsla) {
    let style = window.text_style();
    let (display_text, text_color) = if input.content.is_empty() {
        (input.placeholder.clone(), {
            let mut dimmed = style.color;
            dimmed.a *= 0.4;
            dimmed
        })
    } else {
        (input.content.clone(), style.color)
    };

    let run = TextRun {
        len: display_text.len(),
        font: style.font(),
        color: text_color,
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    // A marked range is text the input method is still composing; it is
    // underlined so the user can see it is not committed yet.
    let runs = if let Some(marked_range) = input.marked_range.as_ref() {
        vec![
            TextRun {
                len: marked_range.start,
                ..run.clone()
            },
            TextRun {
                len: marked_range.end - marked_range.start,
                underline: Some(UnderlineStyle {
                    color: Some(run.color),
                    thickness: px(1.0),
                    wavy: false,
                }),
                ..run.clone()
            },
            TextRun {
                len: display_text.len() - marked_range.end,
                ..run
            },
        ]
        .into_iter()
        .filter(|run| run.len > 0)
        .collect()
    } else {
        vec![run]
    };

    let font_size = style.font_size.to_pixels(window.rem_size());
    let lines = window
        .text_system()
        .shape_text(display_text, font_size, &runs, wrap_width, None)
        .map(|lines| lines.into_iter().collect::<Vec<_>>())
        .unwrap_or_default();
    (lines, text_color)
}

/// The height the shaped text occupies, in whole rows.
fn rows_of(lines: &[WrappedLine], line_height: Pixels) -> Pixels {
    lines
        .iter()
        .fold(px(0.), |total, line| total + line.size(line_height).height)
}

impl IntoElement for TextElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TextElement {
    type RequestLayoutState = ();
    type PrepaintState = TextPrepaint;

    fn id(&self) -> Option<gpui::ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();

        let (multiline, rows) = {
            let input = self.input.read(cx);
            (input.multiline, input.rows.max(1))
        };
        if !multiline {
            style.size.height = window.line_height().into();
            return (window.request_layout(style, [], cx), ());
        }

        // A multi-line field is as tall as what it holds, down to `rows`. The
        // height cannot be known before the width is, because the width is what
        // the text wraps to, so it is measured rather than declared.
        let input = self.input.clone();
        let layout = window.request_measured_layout(
            style,
            move |known_dimensions, available_space, window, cx| {
                let width = known_dimensions.width.or(match available_space.width {
                    gpui::AvailableSpace::Definite(width) => Some(width),
                    _ => None,
                });
                let line_height = window.line_height();
                let (lines, _) = shape(input.read(cx), width, window);
                let height = rows_of(&lines, line_height).max(line_height * rows as f32);
                Size {
                    width: width.unwrap_or(px(0.)),
                    height,
                }
            },
        );
        (layout, ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let line_height = window.line_height();
        let (multiline, selected_range, cursor_offset) = {
            let input = self.input.read(cx);
            (
                input.multiline,
                input.selected_range.clone(),
                input.cursor_offset(),
            )
        };
        let wrap_width = multiline.then_some(bounds.size.width);
        let (lines, text_color) = shape(self.input.read(cx), wrap_width, window);
        let lines = Rc::new(lines);

        // The geometry helpers read the layout of the frame being built, so it
        // is stored before the cursor and the selection are placed from it.
        self.input.update(cx, |input, _cx| {
            input.last_layout = Some(lines.clone());
            input.last_line_height = line_height;
            input.last_bounds = Some(bounds);
        });
        let input = self.input.read(cx);

        let cursor = selected_range
            .is_empty()
            .then(|| input.position_for_offset(cursor_offset))
            .flatten()
            .map(|position| {
                fill(
                    Bounds::new(
                        bounds.origin + point(position.x, position.y),
                        size(px(2.), line_height),
                    ),
                    text_color,
                )
            });

        // A selection that spans rows is painted as one rectangle per row: from
        // the start to the end of its row, whole rows in between, and the last
        // row up to the end.
        let mut selection = Vec::new();
        if !selected_range.is_empty()
            && let (Some(from), Some(to)) = (
                input.position_for_offset(selected_range.start),
                input.position_for_offset(selected_range.end),
            )
        {
            let right = bounds.size.width;
            let mut row = from.y;
            while row < to.y {
                let left = if row == from.y { from.x } else { px(0.) };
                selection.push(fill(
                    Bounds::from_corners(
                        bounds.origin + point(left, row),
                        bounds.origin + point(right, row + line_height),
                    ),
                    rgba(0x3311ff40),
                ));
                row += line_height;
            }
            let left = if from.y == to.y { from.x } else { px(0.) };
            selection.push(fill(
                Bounds::from_corners(
                    bounds.origin + point(left, to.y),
                    bounds.origin + point(to.x, to.y + line_height),
                ),
                rgba(0x3311ff40),
            ));
        }

        TextPrepaint {
            lines,
            cursor,
            selection,
        }
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus = self.input.read(cx).focus.clone();
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        for selection in prepaint.selection.drain(..) {
            window.paint_quad(selection);
        }
        let line_height = window.line_height();
        let mut origin = bounds.origin;
        for line in prepaint.lines.iter() {
            let _ = line.paint(origin, line_height, gpui::TextAlign::Left, None, window, cx);
            origin.y += line.size(line_height).height;
        }
        if focus.is_focused(window)
            && let Some(cursor) = prepaint.cursor.take()
        {
            window.paint_quad(cursor);
        }
    }
}
