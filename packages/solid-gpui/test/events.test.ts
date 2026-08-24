import { describe, expect, it } from "vitest";
import { eventNameFromProp } from "../src/events.js";

describe("eventNameFromProp", () => {
  it("strips the prefix and lower-cases the first letter", () => {
    expect(eventNameFromProp("onClick")).toBe("click");
    expect(eventNameFromProp("onKeyDown")).toBe("keyDown");
    expect(eventNameFromProp("onScrollWheel")).toBe("scrollWheel");
  });

  it("rejects props that only look like listeners", () => {
    expect(eventNameFromProp("once")).toBeNull();
    expect(eventNameFromProp("on")).toBeNull();
    expect(eventNameFromProp("style")).toBeNull();
  });

  it("knows the listeners added alongside the newer elements", () => {
    expect(eventNameFromProp("onFocus")).toBe("focus");
    expect(eventNameFromProp("onBlur")).toBe("blur");
    expect(eventNameFromProp("onDragStart")).toBe("dragStart");
    expect(eventNameFromProp("onDrop")).toBe("drop");
    expect(eventNameFromProp("onScroll")).toBe("scroll");
    expect(eventNameFromProp("onRange")).toBe("range");
    expect(eventNameFromProp("onInput")).toBe("input");
    expect(eventNameFromProp("onMousePressure")).toBe("mousePressure");
    expect(eventNameFromProp("onPinch")).toBe("pinch");
    expect(eventNameFromProp("onAuxClick")).toBe("auxClick");
  });

  it("rejects listeners the host cannot attach", () => {
    expect(eventNameFromProp("onDoubleClick")).toBeNull();
    expect(eventNameFromProp("onSubmit")).toBeNull();
  });
});
