import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeController } from "./opencode.js";

const session = {
  id: "ses_test",
  slug: "test",
  projectID: "project",
  directory: "/tmp/project",
  title: "Real SDK session",
  version: "1",
  time: { created: 1, updated: 2 },
};

const childSession = {
  ...session,
  id: "ses_child",
  slug: "child",
  title: "Background task",
  parentID: session.id,
  time: { created: 2, updated: 3 },
};

const message = (id: string, created: number) => ({
  info: {
    id,
    sessionID: "ses_test",
    role: "user" as const,
    time: { created },
    agent: "build",
    model: { providerID: "test", modelID: "model" },
  },
  parts: [],
});

const initialMessages = Array.from({ length: 100 }, (_, index) => message(`msg_${index}`, index));

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

describe("desktop OpenCodeController", () => {
  const controllers: OpenCodeController[] = [];
  afterEach(() => controllers.splice(0).forEach((controller) => controller.stop()));

  it("boots through the v2 SDK and loads project state", async () => {
    const requests: string[] = [];
    const promptBodies: unknown[] = [];
    const shellBodies: unknown[] = [];
    const revertBodies: unknown[] = [];
    let failPrompts = false;
    let eventResponse: ServerResponse | undefined;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      requests.push(url.pathname);
      if (url.pathname === "/global/health") return json(response, { healthy: true, version: "test" });
      if (url.pathname === "/session") return json(response, [childSession, session]);
      if (url.pathname === "/session/status") return json(response, {});
      if (url.pathname === "/provider") return json(response, { all: [], connected: [], default: {} });
      if (url.pathname === "/permission" || url.pathname === "/question") return json(response, []);
      if (url.pathname === "/session/ses_test/message") {
        return json(response, url.searchParams.has("before") ? [message("msg_older_1", -2), message("msg_older_2", -1)] : initialMessages);
      }
      if (url.pathname === "/session/ses_child/message") return json(response, []);
      if (url.pathname === "/session/ses_child/abort") return json(response, true);
      if (url.pathname === "/session/ses_test/revert") {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => { revertBodies.push(JSON.parse(body)); json(response, session); });
        return;
      }
      if (url.pathname === "/session/ses_test/command") return json(response, { info: { ...session, role: "assistant" }, parts: [] });
      if (url.pathname === "/session/ses_test/shell") {
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => { shellBodies.push(JSON.parse(body)); json(response, { info: { ...session, role: "assistant" }, parts: [] }); });
        return;
      }
      if (url.pathname === "/session/ses_test/share") {
        return json(response, request.method === "DELETE" ? session : { ...session, share: { url: "https://example.test/share" } });
      }
      if (url.pathname === "/project") return json(response, [{ id: "project", worktree: "/tmp/project", vcs: "git", time: { created: 1, updated: 2 } }]);
      if (url.pathname === "/agent") return json(response, [
        { name: "build", description: "Build agent", mode: "primary", hidden: false, permission: {}, options: {} },
        { name: "reviewer", description: "Review changes", mode: "subagent", hidden: false, permission: {}, options: {} },
      ]);
      if (url.pathname === "/api/reference") return json(response, { location: { directory: "/tmp/project" }, data: [{ name: "design", path: "/tmp/references/design", description: "Design reference", source: { type: "local", path: "/refs/design" } }] });
      if (url.pathname === "/experimental/resource") return json(response, { "docs:docs://api": { name: "API docs", uri: "docs://api", client: "docs", mimeType: "text/markdown" } });
      if (url.pathname === "/command") return json(response, [{ name: "test", description: "Run tests", template: "test", source: "command" }]);
      if (url.pathname === "/find/file") return json(response, ["src/app.ts", "src/opencode.ts"]);
      if (url.pathname === "/file") return json(response, [{ name: "src", path: "src", type: "directory", ignored: false }]);
      if (url.pathname === "/file/content") return json(response, { type: "text", content: `contents of ${url.searchParams.get("path")}`, mimeType: "text/typescript" });
      if (url.pathname === "/vcs/status") return json(response, [{ file: "src/app.ts", status: "modified", additions: 3, deletions: 1 }]);
      if (url.pathname === "/mcp") return json(response, { docs: { status: "connected" } });
      if (url.pathname === "/session/ses_test/prompt_async") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          promptBodies.push(JSON.parse(body));
          response.writeHead(failPrompts ? 500 : 204, failPrompts ? { "content-type": "application/json" } : undefined)
            .end(failPrompts ? JSON.stringify({ error: "prompt rejected" }) : undefined);
        });
        return;
      }
      if (url.pathname === "/event") {
        eventResponse = response;
        response.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
        response.write(": connected\n\n");
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock server did not bind");

    const controller = new OpenCodeController({
      directory: "/tmp/project",
      url: `http://127.0.0.1:${address.port}`,
      username: "opencode",
      spawn: false,
    });
    controllers.push(controller);
    await controller.connect();

    expect(controller.state.connection).toBe("connected");
    expect(controller.state.sessions.map((item) => item.title)).toEqual(["Background task", "Real SDK session"]);
    expect(controller.state.selectedID).toBe("ses_test");
    expect(controller.state.projects).toHaveLength(1);
    expect(controller.state.agents.map((agent) => agent.name)).toEqual(["build"]);
    expect(controller.state.mentionAgents.map((agent) => agent.name)).toEqual(["reviewer"]);
    expect(controller.state.references.map((item) => item.name)).toEqual(["design"]);
    expect(controller.state.resources.map((item) => item.uri)).toEqual(["docs://api"]);
    expect(controller.state.commands.map((command) => command.name)).toEqual(["test"]);
    expect(controller.state.files).toEqual([expect.objectContaining({ path: "src", type: "directory" })]);
    expect(controller.state.fileStatus).toEqual([expect.objectContaining({ file: "src/app.ts", status: "modified" })]);
    expect(controller.state.mcp).toMatchObject({ docs: { status: "connected" } });
    expect(await controller.searchFiles("app")).toEqual(["src/app.ts", "src/opencode.ts"]);
    expect((await controller.searchMentions("")).map((item) => item.kind)).toEqual(["reference", "agent", "resource"]);
    expect(controller.state.hasOlderMessages).toBe(true);
    await controller.selectSession("ses_child");
    await controller.refresh();
    expect(controller.state.selectedID).toBe("ses_child");
    await controller.selectSession("ses_test");
    await controller.abort("ses_child");
    expect(controller.state.selectedID).toBe("ses_test");
    expect(controller.state.statuses["ses_child"]).toEqual({ type: "idle" });
    expect(requests).toContain("/session/ses_child/abort");
    await expect(controller.loadOlderMessages()).resolves.toBe(2);
    expect(controller.state.messages[0]?.info.id).toBe("msg_older_1");
    expect(controller.state.hasOlderMessages).toBe(false);
    await controller.openFile("src/app.ts");
    await controller.openFile("src/opencode.ts");
    expect(controller.state.openFiles).toEqual([
      expect.objectContaining({ path: "src/app.ts", loading: false, content: expect.objectContaining({ content: "contents of src/app.ts" }) }),
      expect.objectContaining({ path: "src/opencode.ts", loading: false, content: expect.objectContaining({ content: "contents of src/opencode.ts" }) }),
    ]);
    expect(controller.state.selectedFile).toBe("src/opencode.ts");
    controller.closeFile("src/opencode.ts");
    expect(controller.state.selectedFile).toBe("src/app.ts");
    expect(requests).toEqual(expect.arrayContaining([
      "/global/health",
      "/session",
      "/session/status",
      "/provider",
      "/permission",
      "/question",
      "/session/ses_test/message",
      "/project",
      "/agent",
      "/api/reference",
      "/experimental/resource",
      "/command",
      "/file",
      "/vcs/status",
      "/mcp",
      "/find/file",
    ]));

    const optimisticSend = controller.send("check @src/app.ts @Pasted image 1.png @reviewer @API docs", [
      { path: "src/app.ts", start: 6, end: 17, text: "@src/app.ts" },
      { filename: "Pasted image 1.png", mime: "image/png", url: "data:image/png;base64,iVBORw==", start: 18, end: 37, text: "@Pasted image 1.png" },
      { filename: "API docs", mime: "text/markdown", url: "docs://api", start: 48, end: 57, text: "@API docs", resource: { clientName: "docs", uri: "docs://api" } },
    ], { agent: "build", model: { providerID: "test", modelID: "model" }, variant: "high", agents: [
      { name: "reviewer", start: 38, end: 47, text: "@reviewer" },
    ], contexts: [
      { path: "src/opencode.ts", startLine: 12, endLine: 8, side: "new" },
      { path: "src/opencode.ts", startLine: 8, endLine: 12, side: "new" },
    ] });
    const optimistic = controller.state.messages.at(-1)!;
    expect(optimistic.info).toMatchObject({ id: expect.stringMatching(/^msg_/), role: "user", agent: "build", model: { variant: "high" } });
    expect(optimistic.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.stringMatching(/^prt_/), messageID: optimistic.info.id, type: "text", text: "check @src/app.ts @Pasted image 1.png @reviewer @API docs" }),
    ]));
    await optimisticSend;
    expect(promptBodies).toEqual([expect.objectContaining({
      messageID: optimistic.info.id,
      variant: "high",
      parts: [
        expect.objectContaining({ id: expect.stringMatching(/^prt_/), type: "text", text: "check @src/app.ts @Pasted image 1.png @reviewer @API docs" }),
        expect.objectContaining({
          type: "file",
          filename: "app.ts",
          url: "file:///tmp/project/src/app.ts",
          source: { type: "file", path: "src/app.ts", text: { value: "@src/app.ts", start: 6, end: 17 } },
        }),
        expect.objectContaining({
          type: "file",
          filename: "Pasted image 1.png",
          mime: "image/png",
          url: "data:image/png;base64,iVBORw==",
        }),
        expect.objectContaining({
          type: "file",
          filename: "API docs",
          mime: "text/markdown",
          url: "docs://api",
          source: { type: "resource", clientName: "docs", uri: "docs://api", text: { value: "@API docs", start: 48, end: 57 } },
        }),
        expect.objectContaining({
          type: "agent",
          name: "reviewer",
          source: { value: "@reviewer", start: 38, end: 47 },
        }),
        expect.objectContaining({
          type: "file",
          filename: "opencode.ts",
          mime: "text/plain",
          url: "file:///tmp/project/src/opencode.ts?start=8&end=12",
        }),
      ],
    })]);

    const deadline = Date.now() + 1_000;
    while (!eventResponse && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!eventResponse) throw new Error("event stream did not connect");
    const emit = (event: unknown) => eventResponse!.write(`data: ${JSON.stringify(event)}\n\n`);

    const optimisticPart = optimistic.parts[0]!;
    emit({ type: "message.updated", properties: { info: { ...optimistic.info, time: { created: optimistic.info.time.created + 1 } } } });
    emit({ type: "message.part.updated", properties: { part: { ...optimisticPart, text: "server-confirmed text" } } });
    while (!controller.state.messages.find((item) => item.info.id === optimistic.info.id)?.parts
      .some((part) => part.id === optimisticPart.id && part.type === "text" && part.text === "server-confirmed text")
      && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(controller.state.messages.filter((item) => item.info.id === optimistic.info.id)).toHaveLength(1);
    expect(controller.state.messages.find((item) => item.info.id === optimistic.info.id)?.parts.filter((part) => part.id === optimisticPart.id)).toHaveLength(1);

    controller.selectVariant("balanced");
    await controller.send("queued follow-up");
    expect(controller.state.queued).toEqual([expect.objectContaining({ kind: "prompt", text: "queued follow-up", variant: "balanced" })]);
    emit({ type: "session.idle", properties: { sessionID: "ses_test" } });
    while (promptBodies.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(promptBodies[1]).toMatchObject({ variant: "balanced", parts: [{ type: "text", text: "queued follow-up" }] });
    expect(controller.state.queued).toEqual([]);
    emit({ type: "session.idle", properties: { sessionID: "ses_test" } });
    while (controller.state.busy && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));

    await controller.runCommand("test", "--watch");
    expect(requests).toContain("/session/ses_test/command");
    emit({ type: "session.idle", properties: { sessionID: "ses_test" } });
    while (controller.state.busy && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    await controller.runShell("pwd");
    expect(shellBodies).toEqual([expect.objectContaining({ command: "pwd" })]);
    expect(await controller.toggleShare()).toBe("https://example.test/share");
    expect(controller.state.sessions.find((item) => item.id === "ses_test")?.share?.url).toBe("https://example.test/share");
    expect(await controller.toggleShare()).toBeUndefined();

    emit({ type: "message.updated", properties: { info: {
      id: "msg_streamed",
      sessionID: "ses_test",
      role: "user",
      time: { created: 3 },
      agent: "build",
      model: { providerID: "test", modelID: "model", variant: "fast" },
    } } });
    emit({ type: "message.part.updated", properties: { part: {
      id: "part_streamed",
      sessionID: "ses_test",
      messageID: "msg_streamed",
      type: "text",
      text: "streamed from SSE",
    } } });
    emit({ type: "session.status", properties: { sessionID: "ses_test", status: { type: "busy" } } });
    while (!controller.state.messages.some((message) => message.info.id === "msg_streamed" && message.parts.length > 0) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(controller.state.messages.find((message) => message.info.id === "msg_streamed")?.parts[0]).toMatchObject({ type: "text", text: "streamed from SSE" });
    expect(controller.state.busy).toBe(true);

    emit({ type: "session.idle", properties: { sessionID: "ses_test" } });
    while (controller.state.busy && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    await controller.retryMessage("msg_streamed");
    expect(revertBodies).toEqual([{ messageID: "msg_streamed" }]);
    expect(promptBodies.at(-1)).toMatchObject({
      messageID: expect.stringMatching(/^msg_/),
      agent: "build",
      model: { providerID: "test", modelID: "model" },
      variant: "fast",
      parts: [{ type: "text", text: "streamed from SSE" }],
    });
    expect(promptBodies.at(-1)).not.toMatchObject({ messageID: "msg_streamed" });

    emit({ type: "session.idle", properties: { sessionID: "ses_test" } });
    while (controller.state.busy && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    failPrompts = true;
    const failed = controller.send("remove this optimistic turn", [], { agent: "build", model: { providerID: "test", modelID: "model" } });
    const failedID = controller.state.messages.at(-1)!.info.id;
    expect(failedID).toMatch(/^msg_/);
    await expect(failed).rejects.toBeDefined();
    expect(controller.state.messages.some((item) => item.info.id === failedID)).toBe(false);

    failPrompts = false;
    await controller.send("busy first", [], { agent: "build", model: { providerID: "test", modelID: "model" } });
    await controller.send("do not retry-loop", [], { agent: "build", model: { providerID: "test", modelID: "model" } });
    failPrompts = true;
    emit({ type: "session.idle", properties: { sessionID: "ses_test" } });
    const queueDeadline = Date.now() + 1_000;
    while (!controller.state.queuePaused && Date.now() < queueDeadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(controller.state.queuePaused).toBe(true);
    expect(controller.state.queued).toEqual([expect.objectContaining({ kind: "prompt", text: "do not retry-loop" })]);
    emit({ type: "session.idle", properties: { sessionID: "ses_test" } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(controller.state.queued).toHaveLength(1);

    controller.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});
