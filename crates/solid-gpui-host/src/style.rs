//! Translation from the wire style object into gpui's [`StyleRefinement`].
//!
//! The JavaScript side has already expanded shorthands, parsed units and
//! converted colours, so every function here is a direct field assignment. Any
//! value the wire format does not recognise is dropped rather than defaulted,
//! which keeps an unknown keyword from silently changing the layout.

use gpui::{
    AbsoluteLength, AlignContent, AlignItems, AlignSelf, BorderStyle, BoxShadow, CursorStyle,
    DefiniteLength, Display, FlexDirection, FlexWrap, FontStyle, FontWeight, GridTemplate,
    GridTemplateMinSize, Hsla, JustifyContent, Length, Overflow, Position,
    SharedString, StrikethroughStyle, StyleRefinement, TextAlign, TextOverflow, UnderlineStyle,
    Visibility, WhiteSpace, point, px, relative, rems,
};
use serde::Deserialize;

/// A length in the notation the JavaScript side emits.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "k", content = "v")]
pub enum WireLength {
    #[serde(rename = "px")]
    Pixels(f32),
    #[serde(rename = "rem")]
    Rems(f32),
    /// A fraction of the parent, 0..1.
    #[serde(rename = "pct")]
    Fraction(f32),
    #[serde(rename = "auto")]
    Auto,
}

impl WireLength {
    pub fn to_length(self) -> Length {
        match self {
            WireLength::Auto => Length::Auto,
            other => Length::Definite(other.to_definite()),
        }
    }

    pub fn to_definite(self) -> DefiniteLength {
        match self {
            WireLength::Pixels(value) => DefiniteLength::Absolute(AbsoluteLength::Pixels(px(value))),
            WireLength::Rems(value) => DefiniteLength::Absolute(AbsoluteLength::Rems(rems(value))),
            WireLength::Fraction(value) => relative(value),
            // `auto` has no meaning for padding or gaps; treating it as zero
            // keeps the layout closer to what the author probably meant than
            // falling back to the element's inherited value.
            WireLength::Auto => DefiniteLength::Absolute(AbsoluteLength::Pixels(px(0.))),
        }
    }

    pub fn to_absolute(self) -> AbsoluteLength {
        match self {
            WireLength::Pixels(value) => AbsoluteLength::Pixels(px(value)),
            WireLength::Rems(value) => AbsoluteLength::Rems(rems(value)),
            WireLength::Fraction(_) | WireLength::Auto => AbsoluteLength::Pixels(px(0.)),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct WireColor {
    pub h: f32,
    pub s: f32,
    pub l: f32,
    pub a: f32,
}

impl From<WireColor> for Hsla {
    fn from(value: WireColor) -> Self {
        Hsla {
            h: value.h,
            s: value.s,
            l: value.l,
            a: value.a,
        }
    }
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct WireEdges {
    pub top: Option<WireLength>,
    pub right: Option<WireLength>,
    pub bottom: Option<WireLength>,
    pub left: Option<WireLength>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct WireCorners {
    pub top_left: Option<WireLength>,
    pub top_right: Option<WireLength>,
    pub bottom_left: Option<WireLength>,
    pub bottom_right: Option<WireLength>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct WireSize {
    pub width: Option<WireLength>,
    pub height: Option<WireLength>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct WireOverflow {
    pub x: Option<String>,
    pub y: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireShadow {
    pub color: WireColor,
    pub offset: WireOffset,
    pub blur_radius: f32,
    pub spread_radius: f32,
    pub inset: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireOffset {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct WireUnderline {
    pub color: Option<WireColor>,
    pub thickness: Option<f32>,
    pub wavy: Option<bool>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct WireStrikethrough {
    pub color: Option<WireColor>,
    pub thickness: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireTextOverflow {
    pub kind: String,
    pub ellipsis: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WireGridTemplate {
    pub repeat: u16,
    pub min_size: String,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct WireTextStyle {
    pub color: Option<WireColor>,
    pub font_family: Option<String>,
    pub font_size: Option<WireLength>,
    pub line_height: Option<WireLength>,
    pub font_weight: Option<f32>,
    pub font_style: Option<String>,
    pub background_color: Option<WireColor>,
    pub underline: Option<WireUnderline>,
    pub strikethrough: Option<WireStrikethrough>,
    pub white_space: Option<String>,
    pub text_align: Option<String>,
    pub text_overflow: Option<WireTextOverflow>,
    pub line_clamp: Option<usize>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct WireStyle {
    pub display: Option<String>,
    pub visibility: Option<String>,
    pub position: Option<String>,
    pub overflow: Option<WireOverflow>,
    pub scrollbar_width: Option<WireLength>,
    pub inset: Option<WireEdges>,
    pub size: Option<WireSize>,
    pub min_size: Option<WireSize>,
    pub max_size: Option<WireSize>,
    pub aspect_ratio: Option<f32>,
    pub margin: Option<WireEdges>,
    pub padding: Option<WireEdges>,
    pub border_widths: Option<WireEdges>,
    pub align_items: Option<String>,
    pub align_self: Option<String>,
    pub align_content: Option<String>,
    pub justify_content: Option<String>,
    pub gap: Option<WireSize>,
    pub flex_direction: Option<String>,
    pub flex_wrap: Option<String>,
    pub flex_basis: Option<WireLength>,
    pub flex_grow: Option<f32>,
    pub flex_shrink: Option<f32>,
    pub background: Option<WireColor>,
    pub border_color: Option<WireColor>,
    pub border_style: Option<String>,
    pub corner_radii: Option<WireCorners>,
    pub box_shadow: Option<Vec<WireShadow>>,
    pub opacity: Option<f32>,
    pub mouse_cursor: Option<String>,
    pub grid_cols: Option<WireGridTemplate>,
    pub grid_rows: Option<WireGridTemplate>,
    pub text: Option<WireTextStyle>,
}

fn overflow(name: &str) -> Option<Overflow> {
    match name {
        "visible" => Some(Overflow::Visible),
        "clip" => Some(Overflow::Clip),
        "hidden" => Some(Overflow::Hidden),
        "scroll" => Some(Overflow::Scroll),
        _ => None,
    }
}

fn align_items(name: &str) -> Option<AlignItems> {
    match name {
        "start" => Some(AlignItems::FlexStart),
        "end" => Some(AlignItems::FlexEnd),
        "center" => Some(AlignItems::Center),
        "baseline" => Some(AlignItems::Baseline),
        "stretch" => Some(AlignItems::Stretch),
        _ => None,
    }
}

fn align_self(name: &str) -> Option<AlignSelf> {
    align_items(name)
}

fn align_content(name: &str) -> Option<AlignContent> {
    match name {
        "start" => Some(AlignContent::FlexStart),
        "end" => Some(AlignContent::FlexEnd),
        "center" => Some(AlignContent::Center),
        "space-between" => Some(AlignContent::SpaceBetween),
        "space-around" => Some(AlignContent::SpaceAround),
        "space-evenly" => Some(AlignContent::SpaceEvenly),
        "stretch" => Some(AlignContent::Stretch),
        _ => None,
    }
}

fn justify_content(name: &str) -> Option<JustifyContent> {
    match name {
        "start" => Some(JustifyContent::Start),
        "end" => Some(JustifyContent::End),
        "center" => Some(JustifyContent::Center),
        "space-between" => Some(JustifyContent::SpaceBetween),
        "space-around" => Some(JustifyContent::SpaceAround),
        "space-evenly" => Some(JustifyContent::SpaceEvenly),
        _ => None,
    }
}

fn cursor(name: &str) -> Option<CursorStyle> {
    match name {
        "default" | "arrow" => Some(CursorStyle::Arrow),
        "pointer" => Some(CursorStyle::PointingHand),
        "text" => Some(CursorStyle::IBeam),
        "crosshair" => Some(CursorStyle::Crosshair),
        "grab" => Some(CursorStyle::OpenHand),
        "grabbing" | "move" => Some(CursorStyle::ClosedHand),
        "not-allowed" => Some(CursorStyle::OperationNotAllowed),
        "context-menu" => Some(CursorStyle::ContextualMenu),
        "ew-resize" => Some(CursorStyle::ResizeLeftRight),
        "ns-resize" => Some(CursorStyle::ResizeUpDown),
        "col-resize" => Some(CursorStyle::ResizeColumn),
        "row-resize" => Some(CursorStyle::ResizeRow),
        _ => None,
    }
}

fn grid_template(template: &WireGridTemplate) -> GridTemplate {
    GridTemplate {
        repeat: template.repeat,
        min_size: match template.min_size.as_str() {
            "min-content" => GridTemplateMinSize::MinContent,
            "max-content" => GridTemplateMinSize::MaxContent,
            _ => GridTemplateMinSize::Zero,
        },
    }
}

fn apply_text(wire: &WireTextStyle, style: &mut StyleRefinement) {
    let text = &mut style.text;
    if let Some(color) = wire.color {
        text.color = Some(color.into());
    }
    if let Some(family) = &wire.font_family {
        text.font_family = Some(SharedString::from(family.clone()));
    }
    if let Some(size) = wire.font_size {
        text.font_size = Some(size.to_absolute());
    }
    if let Some(height) = wire.line_height {
        text.line_height = Some(height.to_definite());
    }
    if let Some(weight) = wire.font_weight {
        text.font_weight = Some(FontWeight(weight));
    }
    if let Some(name) = &wire.font_style {
        text.font_style = match name.as_str() {
            "italic" => Some(FontStyle::Italic),
            "oblique" => Some(FontStyle::Oblique),
            "normal" => Some(FontStyle::Normal),
            _ => text.font_style,
        };
    }
    if let Some(color) = wire.background_color {
        text.background_color = Some(color.into());
    }
    if let Some(underline) = &wire.underline {
        text.underline = Some(UnderlineStyle {
            thickness: px(underline.thickness.unwrap_or(1.)),
            color: underline.color.map(Into::into),
            wavy: underline.wavy.unwrap_or(false),
        });
    }
    if let Some(strikethrough) = &wire.strikethrough {
        text.strikethrough = Some(StrikethroughStyle {
            thickness: px(strikethrough.thickness.unwrap_or(1.)),
            color: strikethrough.color.map(Into::into),
        });
    }
    if let Some(name) = &wire.white_space {
        text.white_space = match name.as_str() {
            "nowrap" => Some(WhiteSpace::Nowrap),
            "normal" => Some(WhiteSpace::Normal),
            _ => text.white_space,
        };
    }
    if let Some(name) = &wire.text_align {
        text.text_align = match name.as_str() {
            "left" => Some(TextAlign::Left),
            "center" => Some(TextAlign::Center),
            "right" => Some(TextAlign::Right),
            _ => text.text_align,
        };
    }
    if let Some(overflow) = &wire.text_overflow {
        let ellipsis = SharedString::from(overflow.ellipsis.clone());
        text.text_overflow = match overflow.kind.as_str() {
            "truncate" => Some(TextOverflow::Truncate(ellipsis)),
            "truncate_start" => Some(TextOverflow::TruncateStart(ellipsis)),
            "truncate_middle" => Some(TextOverflow::TruncateMiddle(ellipsis)),
            _ => None,
        };
    }
    if let Some(clamp) = wire.line_clamp {
        text.line_clamp = Some(clamp);
    }
}

/// Merges a wire style into an existing refinement, leaving untouched fields
/// alone so hover and active styles can layer over the base style.
pub fn apply(wire: &WireStyle, style: &mut StyleRefinement) {
    if let Some(name) = &wire.display {
        style.display = match name.as_str() {
            "flex" => Some(Display::Flex),
            "block" => Some(Display::Block),
            "grid" => Some(Display::Grid),
            "none" => Some(Display::None),
            _ => style.display,
        };
    }
    if let Some(name) = &wire.visibility {
        style.visibility = match name.as_str() {
            "visible" => Some(Visibility::Visible),
            "hidden" => Some(Visibility::Hidden),
            _ => style.visibility,
        };
    }
    if let Some(name) = &wire.position {
        style.position = match name.as_str() {
            "absolute" => Some(Position::Absolute),
            "relative" => Some(Position::Relative),
            _ => style.position,
        };
    }

    if let Some(wire_overflow) = &wire.overflow {
        if let Some(value) = wire_overflow.x.as_deref().and_then(overflow) {
            style.overflow.x = Some(value);
        }
        if let Some(value) = wire_overflow.y.as_deref().and_then(overflow) {
            style.overflow.y = Some(value);
        }
    }
    if let Some(width) = wire.scrollbar_width {
        style.scrollbar_width = Some(width.to_absolute());
    }

    if let Some(inset) = &wire.inset {
        if let Some(value) = inset.top {
            style.inset.top = Some(value.to_length());
        }
        if let Some(value) = inset.right {
            style.inset.right = Some(value.to_length());
        }
        if let Some(value) = inset.bottom {
            style.inset.bottom = Some(value.to_length());
        }
        if let Some(value) = inset.left {
            style.inset.left = Some(value.to_length());
        }
    }

    for (wire_size, target) in [
        (&wire.size, 0usize),
        (&wire.min_size, 1),
        (&wire.max_size, 2),
    ] {
        let Some(wire_size) = wire_size else { continue };
        let size = match target {
            0 => &mut style.size,
            1 => &mut style.min_size,
            _ => &mut style.max_size,
        };
        if let Some(value) = wire_size.width {
            size.width = Some(value.to_length());
        }
        if let Some(value) = wire_size.height {
            size.height = Some(value.to_length());
        }
    }

    if let Some(ratio) = wire.aspect_ratio {
        style.aspect_ratio = Some(ratio);
    }

    if let Some(margin) = &wire.margin {
        if let Some(value) = margin.top {
            style.margin.top = Some(value.to_length());
        }
        if let Some(value) = margin.right {
            style.margin.right = Some(value.to_length());
        }
        if let Some(value) = margin.bottom {
            style.margin.bottom = Some(value.to_length());
        }
        if let Some(value) = margin.left {
            style.margin.left = Some(value.to_length());
        }
    }

    if let Some(padding) = &wire.padding {
        if let Some(value) = padding.top {
            style.padding.top = Some(value.to_definite());
        }
        if let Some(value) = padding.right {
            style.padding.right = Some(value.to_definite());
        }
        if let Some(value) = padding.bottom {
            style.padding.bottom = Some(value.to_definite());
        }
        if let Some(value) = padding.left {
            style.padding.left = Some(value.to_definite());
        }
    }

    if let Some(borders) = &wire.border_widths {
        if let Some(value) = borders.top {
            style.border_widths.top = Some(value.to_absolute());
        }
        if let Some(value) = borders.right {
            style.border_widths.right = Some(value.to_absolute());
        }
        if let Some(value) = borders.bottom {
            style.border_widths.bottom = Some(value.to_absolute());
        }
        if let Some(value) = borders.left {
            style.border_widths.left = Some(value.to_absolute());
        }
    }

    if let Some(value) = wire.align_items.as_deref().and_then(align_items) {
        style.align_items = Some(value);
    }
    if let Some(value) = wire.align_self.as_deref().and_then(align_self) {
        style.align_self = Some(value);
    }
    if let Some(value) = wire.align_content.as_deref().and_then(align_content) {
        style.align_content = Some(value);
    }
    if let Some(value) = wire.justify_content.as_deref().and_then(justify_content) {
        style.justify_content = Some(value);
    }

    if let Some(gap) = &wire.gap {
        if let Some(value) = gap.width {
            style.gap.width = Some(value.to_definite());
        }
        if let Some(value) = gap.height {
            style.gap.height = Some(value.to_definite());
        }
    }

    if let Some(name) = &wire.flex_direction {
        style.flex_direction = match name.as_str() {
            "row" => Some(FlexDirection::Row),
            "column" => Some(FlexDirection::Column),
            "row-reverse" => Some(FlexDirection::RowReverse),
            "column-reverse" => Some(FlexDirection::ColumnReverse),
            _ => style.flex_direction,
        };
    }
    if let Some(name) = &wire.flex_wrap {
        style.flex_wrap = match name.as_str() {
            "nowrap" => Some(FlexWrap::NoWrap),
            "wrap" => Some(FlexWrap::Wrap),
            "wrap-reverse" => Some(FlexWrap::WrapReverse),
            _ => style.flex_wrap,
        };
    }
    if let Some(basis) = wire.flex_basis {
        style.flex_basis = Some(basis.to_length());
    }
    if let Some(grow) = wire.flex_grow {
        style.flex_grow = Some(grow);
    }
    if let Some(shrink) = wire.flex_shrink {
        style.flex_shrink = Some(shrink);
    }

    if let Some(color) = wire.background {
        style.background = Some(Hsla::from(color).into());
    }
    if let Some(color) = wire.border_color {
        style.border_color = Some(color.into());
    }
    if let Some(name) = &wire.border_style {
        style.border_style = match name.as_str() {
            "dashed" => Some(BorderStyle::Dashed),
            "solid" => Some(BorderStyle::Solid),
            _ => style.border_style,
        };
    }

    if let Some(radii) = &wire.corner_radii {
        if let Some(value) = radii.top_left {
            style.corner_radii.top_left = Some(value.to_absolute());
        }
        if let Some(value) = radii.top_right {
            style.corner_radii.top_right = Some(value.to_absolute());
        }
        if let Some(value) = radii.bottom_left {
            style.corner_radii.bottom_left = Some(value.to_absolute());
        }
        if let Some(value) = radii.bottom_right {
            style.corner_radii.bottom_right = Some(value.to_absolute());
        }
    }

    if let Some(shadows) = &wire.box_shadow {
        style.box_shadow = Some(
            shadows
                .iter()
                .map(|shadow| BoxShadow {
                    color: shadow.color.into(),
                    offset: point(px(shadow.offset.x), px(shadow.offset.y)),
                    blur_radius: px(shadow.blur_radius),
                    spread_radius: px(shadow.spread_radius),
                    inset: shadow.inset,
                })
                .collect(),
        );
    }

    if let Some(opacity) = wire.opacity {
        style.opacity = Some(opacity);
    }
    if let Some(value) = wire.mouse_cursor.as_deref().and_then(cursor) {
        style.mouse_cursor = Some(value);
    }
    if let Some(template) = &wire.grid_cols {
        style.grid_cols = Some(grid_template(template));
    }
    if let Some(template) = &wire.grid_rows {
        style.grid_rows = Some(grid_template(template));
    }
    if let Some(text) = &wire.text {
        apply_text(text, style);
    }
}
