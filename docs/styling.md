# Styling

Every element takes a `style` prop. Styles are a CSS-flavoured object;
shorthands, units and colours are normalised in JavaScript and land on gpui's
`StyleRefinement` unchanged. The elements they apply to are listed in
[elements.md](elements.md).

```tsx
<div
  group="row"
  style={{
    flexDirection: "column",
    gap: 8,
    paddingX: 16,
    paddingY: 12,
    width: "100%",
    maxWidth: 480,
    borderWidth: 1,
    borderColor: "#3a3a44",
    borderRadius: 8,
    background: "rgba(20, 20, 24, 0.9)",
    boxShadow: [{ y: 2, blur: 8, color: "#0006" }],
    color: "#e8e8ee",
    fontSize: 15,
    fontWeight: "medium",
    overflowY: "scroll",
  }}
  hoverStyle={{ borderColor: "#7aa2f7" }}
/>
```

- **Lengths.** A number is pixels. Strings may be `"12px"`, `"1.5rem"`, `"50%"`,
  `"auto"` or `"full"`.
- **Colours.** `"#rgb"`, `"#rrggbb"`, `"#rrggbbaa"`, `rgb()`, `rgba()`, `hsl()`,
  `hsla()`, a handful of names, or `{ h, s, l, a }`. Everything is converted to
  gpui's HSLA.
- **Shorthands.** `padding`, `paddingX`, `paddingTop` and the rest, plus
  `margin*`, `inset`, `top`, `size`, `borderWidth*`, `borderRadius*`, `gap`,
  `columnGap` and `rowGap`.
- **Text.** `color`, `fontSize`, `fontFamily`, `fontWeight` (number or name),
  `fontStyle`, `lineHeight`, `textAlign`, `whiteSpace`, `underline`,
  `strikethrough`, `textOverflow` and `lineClamp` are set on the element and
  inherited by its children, the same way gpui does it.

## State styles

`hoverStyle` and `activeStyle` are layered on top of `style` when gpui reports
the matching state.

`group` names an element. A descendant with `groupOf="name"` and
`groupHoverStyle` or `groupActiveStyle` then restyles when that ancestor is
hovered or pressed.

`dragOverStyle` applies while a drag is held over the element. `occlude` stops
the mouse reaching whatever is painted underneath.

## Animation

`animate` interpolates between two style objects. The host runs the
interpolation itself, so it stays smooth no matter what the application is doing.
A per-frame callback into JavaScript would put a process boundary inside the
animation loop.

```tsx
<div
  animate={{
    duration: 900,
    repeat: true,
    easing: "bounce",
    from: { opacity: 0.25, background: "#7aa2f7" },
    to: { opacity: 1, background: "#9ece6a" },
  }}
/>
```

Easings are `linear`, `quadratic`, `ease-in-out` (the default), `ease-out-quint`
and `bounce`.

Lengths interpolate only when both endpoints use the same unit, because there is
no meaningful midpoint between `10px` and `50%`. Anything that cannot be
interpolated, such as a flex direction, steps to the destination at the start.
