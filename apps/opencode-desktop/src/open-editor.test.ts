import { describe, expect, it } from "vitest";
import { editorLaunches, externalURLLaunch, projectFilePath } from "./open-editor.js";

describe("external editor launcher", () => {
  it("builds line-aware arguments for configured editors", () => {
    expect(editorLaunches("/project/src/app.ts", 12, { OPENCODE_EDITOR: "code" }, "linux")[0]).toEqual({
      command: "code",
      args: ["-g", "/project/src/app.ts:12"],
    });
    expect(editorLaunches("/project/src/app.ts", 12, { OPENCODE_EDITOR: "/opt/zed" }, "linux")[0]).toEqual({
      command: "/opt/zed",
      args: ["/project/src/app.ts:12"],
    });
  });

  it("keeps launched files inside the project", () => {
    expect(projectFilePath("/project", "src/app.ts")).toBe("/project/src/app.ts");
    expect(() => projectFilePath("/project", "../secret.txt")).toThrow("outside the project");
  });

  it("opens only HTTP(S) URLs with the platform browser", () => {
    expect(externalURLLaunch("https://example.com/docs?q=gpui", "linux")).toEqual({
      command: "xdg-open",
      args: ["https://example.com/docs?q=gpui"],
    });
    expect(() => externalURLLaunch("file:///tmp/secret", "linux")).toThrow("HTTP(S)");
  });
});
