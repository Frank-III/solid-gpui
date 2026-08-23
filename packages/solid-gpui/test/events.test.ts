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

  it("rejects listeners the host cannot attach", () => {
    expect(eventNameFromProp("onDragStart")).toBeNull();
    expect(eventNameFromProp("onFocus")).toBeNull();
  });
});
