import { afterEach, describe, expect, it } from "vitest";
import { hostPackageName, resolveHostPath } from "../src/transport.js";

const original = process.env["SOLID_GPUI_HOST"];

afterEach(() => {
  if (original === undefined) delete process.env["SOLID_GPUI_HOST"];
  else process.env["SOLID_GPUI_HOST"] = original;
});

describe("finding the host", () => {
  it("names the package the binary for this machine is published in", () => {
    expect(hostPackageName("darwin", "arm64")).toBe("@solid-gpui/host-darwin-arm64");
    expect(hostPackageName("linux", "x64")).toBe("@solid-gpui/host-linux-x64");
  });

  it("says where it looked when an explicit path is wrong", () => {
    expect(() => resolveHostPath("./nowhere/solid-gpui-host")).toThrow(
      /host binary not found at \.\/nowhere\/solid-gpui-host/,
    );
  });

  it("prefers a locally built binary, so rebuilding the host takes effect", () => {
    // This repository has one; the walk up from the working directory finds it
    // before anything that may be installed.
    expect(resolveHostPath()).toMatch(/solid-gpui-host$/);
  });

  it("falls back to the name on PATH when nothing else is found", () => {
    const cwd = process.cwd();
    try {
      // Nothing is built above the root, and the platform package is not
      // installed here, so the only thing left is the name itself.
      process.chdir("/");
      expect(resolveHostPath()).toBe("solid-gpui-host");
    } finally {
      process.chdir(cwd);
    }
  });
});
