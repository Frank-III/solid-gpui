import type { GpuiStyle } from "solid-gpui";

export const color = {
  deep: "#080808",
  chrome: "#080808",
  canvas: "#161616",
  sidebar: "#080808",
  raised: "#242424",
  raisedHover: "#2e2e2e",
  layer2: "#2e2e2e",
  layer3: "#3a3a3a",
  hover: "#ffffff0f",
  pressed: "#ffffff1a",
  border: "#ffffff14",
  borderStrong: "#ffffff33",
  text: "#fafafa",
  secondary: "#aeaeae",
  tertiary: "#808080",
  accent: "#e68a6a",
  red: "#e06c75",
  blue: "#68a8e4",
  green: "#86b681",
  yellow: "#d2a85c",
} as const;

export const interactive: GpuiStyle = { cursor: "pointer", borderRadius: 6 };

export const raisedShadow = [
  { y: 2, blur: 4, color: "#0000004d" },
  { y: 1, blur: 2, color: "#0000004d" },
  { spread: 0.5, color: "#ffffff29" },
];

export const overlayShadow = [
  { y: 16, blur: 32, color: "#0000004d" },
  { y: 8, blur: 16, color: "#0000004d" },
  { spread: 0.5, color: "#ffffff29" },
];
