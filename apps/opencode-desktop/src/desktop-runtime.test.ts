import { describe, expect, it } from "vitest";
import { DesktopRuntime } from "./desktop-runtime.js";

describe("desktop Effect runtime", () => {
  it("provides configured endpoints and can rebuild after scoped disposal", async () => {
    const runtime = new DesktopRuntime({
      directory: "/tmp/project",
      url: "http://127.0.0.1:5123",
      username: "opencode",
      spawn: false,
    });

    await expect(runtime.endpoint()).resolves.toBe("http://127.0.0.1:5123");
    await runtime.dispose();
    await expect(runtime.endpoint()).resolves.toBe("http://127.0.0.1:5123");
    await runtime.dispose();
  });
});
