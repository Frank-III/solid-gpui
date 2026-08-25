import { describe, expect, it } from "vitest";
import type { MessageItem } from "./opencode.js";
import { transcriptWindow } from "./transcript-window-model.js";

const messages = Array.from({ length: 80 }, (_, index) => ({
  info: { id: `msg_${index}`, sessionID: "session", role: "user", time: { created: index }, agent: "build", model: { providerID: "test", modelID: "model" } },
  parts: [],
})) as MessageItem[];

describe("transcriptWindow", () => {
  it("mounts only the newest bounded page by default", () => {
    const page = transcriptWindow(messages);
    expect(page.messages).toHaveLength(32);
    expect(page.messages[0]?.info.id).toBe("msg_48");
    expect(page.end).toBe(80);
  });

  it("uses a stable message ID as the page boundary", () => {
    const page = transcriptWindow(messages, "msg_48");
    expect(page.messages[0]?.info.id).toBe("msg_16");
    expect(page.messages.at(-1)?.info.id).toBe("msg_47");
  });
});
