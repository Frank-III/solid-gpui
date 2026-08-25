import { createMemo, createSignal, For } from "solid-js";
import type { GpuiChild, GpuiStyle, RangeEvent } from "solid-gpui";

/** A Solid-owned row window rendered by GPUI's native variable-height list. */
export function NativeRows<T>(props: {
  items: readonly T[];
  rowHeight: number;
  visibleRows: number;
  followEnd?: boolean;
  scrollToIndex?: number;
  style?: GpuiStyle;
  children: (item: T, index: number) => GpuiChild;
}) {
  const overscan = 8;
  const [range, setRange] = createSignal<RangeEvent>({ start: 0, end: 0 });
  const first = () => Math.max(0, Math.min(props.items.length, range().start) - overscan);
  const last = () => Math.min(props.items.length, Math.max(range().end, range().start + props.visibleRows) + overscan);
  const rows = createMemo(() => props.items.slice(first(), last()).map((item, offset) => ({ item, index: first() + offset })));

  return (
    <scrollbar
      style={{ flexGrow: 1, minHeight: 0, ...(props.style ?? {}) }}
      thumbStyle={{ minHeight: 24, borderRadius: 4, background: "#ffffff26" }}
    >
      <list
        count={props.items.length}
        start={first()}
        itemHeight={props.rowHeight}
        overdraw={props.rowHeight * overscan}
        align={props.followEnd ? "bottom" : "top"}
        follow={props.followEnd ? "tail" : "normal"}
        scrollToItem={props.scrollToIndex}
        onRange={setRange}
        style={{ flexGrow: 1, minHeight: 0 }}
      >
        <For each={rows()}>
          {(row) => <div style={{ height: props.rowHeight, flexShrink: 0 }}>{props.children(row.item, row.index)}</div>}
        </For>
      </list>
    </scrollbar>
  );
}
