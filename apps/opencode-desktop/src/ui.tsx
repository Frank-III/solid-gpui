import { color, interactive } from "./theme.js";

export function run(action: () => Promise<unknown>): void {
  void action().catch(() => undefined);
}

export function IconButton(props: {
  label: string;
  tooltip?: string;
  danger?: boolean;
  size?: "small" | "normal" | "large";
  selected?: boolean;
  onClick?: () => void;
}) {
  const size = () => props.size === "small" ? 20 : props.size === "large" ? 28 : 24;
  return (
    <div
      tooltip={props.tooltip}
      style={{
        ...interactive,
        width: size(),
        height: size(),
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        background: props.selected ? color.pressed : "transparent",
        color: props.danger ? color.red : props.selected ? color.text : color.tertiary,
        fontSize: props.size === "small" ? 11 : 13,
      }}
      hoverStyle={{
        background: color.hover,
        color: props.danger ? color.red : color.text,
      }}
      activeStyle={{ opacity: 0.65 }}
      onClick={props.onClick}
    >
      {props.label}
    </div>
  );
}

export function Button(props: {
  children: string;
  tone?: "primary" | "danger";
  onClick: () => void;
}) {
  const primary = () => props.tone === "primary";
  return (
    <div
      style={{
        ...interactive,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingX: 10,
        height: 28,
        background: primary() ? color.text : color.raised,
        borderWidth: primary() ? 0 : 1,
        borderColor: color.borderStrong,
        color:
          props.tone === "danger"
            ? color.red
            : primary()
              ? color.canvas
              : color.text,
        fontSize: 13,
        fontWeight: 530,
      }}
      hoverStyle={{
        opacity: 0.82,
        background: primary() ? "#ffffff" : color.raisedHover,
      }}
      onClick={props.onClick}
    >
      {props.children}
    </div>
  );
}

export function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  if (elapsed < minute) return "now";
  if (elapsed < 60 * minute) return `${Math.floor(elapsed / minute)}m`;
  if (elapsed < 24 * 60 * minute)
    return `${Math.floor(elapsed / (60 * minute))}h`;
  return `${Math.floor(elapsed / (24 * 60 * minute))}d`;
}

export function projectName(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}
