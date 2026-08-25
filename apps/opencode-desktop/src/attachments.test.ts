import { describe, expect, it } from "vitest";
import { attachmentFromImage, attachmentFromMention, attachmentFromPath, attachmentFromReference, attachmentFromResource, fileMentions } from "./attachments.js";

describe("composer attachments", () => {
  it("infers useful MIME types for selected and dropped paths", () => {
    expect(attachmentFromPath("/tmp/screenshot.PNG").mime).toBe("image/png");
    expect(attachmentFromPath("src/app.ts").mime).toBe("text/plain");
  });

  it("turns a clipboard image into an OpenCode data URL part", () => {
    const attachment = attachmentFromImage({ type: "image", mime: "image/png", data: "iVBORw==" }, 1);
    expect(fileMentions("inspect @Pasted image 1.png", [attachment])).toEqual([{
      path: undefined,
      filename: "Pasted image 1.png",
      mime: "image/png",
      url: "data:image/png;base64,iVBORw==",
      start: 8,
      end: 27,
      text: "@Pasted image 1.png",
    }]);
  });

  it("preserves references and MCP resource metadata through draft restoration", () => {
    const reference = attachmentFromReference({ name: "docs", path: "/workspace/docs" });
    expect(fileMentions("read @docs", [reference])[0]).toMatchObject({
      path: "/workspace/docs",
      mime: "application/x-directory",
      text: "@docs",
    });

    const resource = attachmentFromResource({ name: "schema", client: "database", uri: "mcp://database/schema", mime: "application/json" });
    const mention = fileMentions("check @schema", [resource])[0]!;
    expect(mention).toMatchObject({
      url: "mcp://database/schema",
      resource: { clientName: "database", uri: "mcp://database/schema" },
      text: "@schema",
    });
    expect(attachmentFromMention(mention, 1)).toMatchObject({
      token: "@schema",
      resource: { clientName: "database", uri: "mcp://database/schema" },
    });
  });
});
