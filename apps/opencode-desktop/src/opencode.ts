import {
  createOpencodeClient,
  type Agent,
  type Command,
  type Event,
  type FileContent,
  type FileNode,
  type Message,
  type McpResource,
  type McpStatus,
  type Model,
  type OpencodeClient,
  type Part,
  type PermissionRequest,
  type Pty,
  type Provider,
  type Project,
  type QuestionRequest,
  type ReferenceInfo,
  type Session,
  type SessionStatus,
  type SnapshotFileDiff,
  type Todo,
  type VcsFileStatus,
} from "@opencode-ai/sdk/v2";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DesktopConfig } from "./config.js";
import { TerminalManager } from "./terminal-manager.js";
import { contextFileURL, type LineSelection } from "./workspace-model.js";
import { mentionSuggestions, type AgentMention, type MentionSuggestion } from "./mentions.js";
import { DesktopRuntime } from "./desktop-runtime.js";

export interface MessageItem {
  info: Message;
  parts: Part[];
}

export interface FileMention {
  path?: string;
  filename?: string;
  mime?: string;
  url?: string;
  start: number;
  end: number;
  text: string;
  resource?: { clientName: string; uri: string };
}

export interface OpenFile {
  path: string;
  content?: FileContent;
  loading: boolean;
}

export interface MessageDraft {
  messageID: string;
  text: string;
  files: FileMention[];
  agents: AgentMention[];
  agent: string;
  model: { providerID: string; modelID: string };
  variant?: string;
}

export type QueuedSubmission =
  | { kind: "prompt"; sessionID: string; text: string; files: FileMention[]; agents: AgentMention[]; contexts: LineSelection[]; agent?: string; model?: { providerID: string; modelID: string }; variant?: string }
  | { kind: "command"; sessionID: string; command: string; args: string; files: FileMention[]; contexts: LineSelection[] }
  | { kind: "shell"; sessionID: string; command: string };

export type ConnectionState = "connecting" | "connected" | "offline";

export interface OpenCodeState {
  connection: ConnectionState;
  endpoint: string;
  directory: string;
  sessions: Session[];
  selectedID?: string;
  messages: MessageItem[];
  loadingMessages: boolean;
  loadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  busy: boolean;
  statuses: Record<string, SessionStatus>;
  error?: string;
  providers: Provider[];
  models: Model[];
  model?: { providerID: string; modelID: string };
  variant?: string;
  permission?: PermissionRequest;
  question?: QuestionRequest;
  projects: Project[];
  agents: Agent[];
  mentionAgents: Agent[];
  agent?: string;
  commands: Command[];
  todos: Todo[];
  browsePath: string;
  files: FileNode[];
  fileStatus: VcsFileStatus[];
  selectedFile?: string;
  openFiles: OpenFile[];
  sessionDiffs: SnapshotFileDiff[];
  mcp: Record<string, McpStatus>;
  references: ReferenceInfo[];
  resources: McpResource[];
  terminals: Pty[];
  terminal?: Pty;
  terminalOutput: string;
  terminalConnection: "closed" | "connecting" | "open" | "error";
  queued: QueuedSubmission[];
  queuePaused: boolean;
}

type Listener = (state: OpenCodeState) => void;
const MESSAGE_PAGE_SIZE = 100;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export class OpenCodeController {
  #state: OpenCodeState;
  #listeners = new Set<Listener>();
  #client?: OpencodeClient;
  #desktop: DesktopRuntime;
  #events?: AbortController;
  #terminals: TerminalManager;
  #stopped = false;
  #loadingMessageIDs = new Set<string>();
  #optimisticMessages = new Map<string, MessageItem>();
  #drainingQueue = false;

  constructor(readonly config: DesktopConfig) {
    this.#state = {
      connection: "connecting",
      endpoint: config.url ?? "local OpenCode service",
      directory: config.directory,
      sessions: [],
      messages: [],
      loadingMessages: false,
      loadingOlderMessages: false,
      hasOlderMessages: false,
      busy: false,
      statuses: {},
      providers: [],
      models: [],
      projects: [],
      agents: [],
      mentionAgents: [],
      commands: [],
      todos: [],
      browsePath: "",
      files: [],
      fileStatus: [],
      openFiles: [],
      sessionDiffs: [],
      mcp: {},
      references: [],
      resources: [],
      terminals: [],
      terminalOutput: "",
      terminalConnection: "closed",
      queued: [],
      queuePaused: false,
    };
    this.#terminals = new TerminalManager({
      directory: config.directory,
      client: () => this.#requireClient(),
      state: () => this.#state,
      update: (patch) => this.#update(patch),
    });
    this.#desktop = new DesktopRuntime(config);
  }

  get state(): OpenCodeState {
    return this.#state;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #update(patch: Partial<OpenCodeState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }

  async connect(): Promise<void> {
    this.#update({ connection: "connecting", error: undefined });
    try {
      const headers = this.config.password
        ? { Authorization: basicAuth(this.config.username, this.config.password) }
        : undefined;
      const url = await this.#desktop.endpoint();
      this.#client = createOpencodeClient({ baseUrl: url, directory: this.config.directory, headers });
      await this.#client.global.health({ throwOnError: true });
      this.#update({ connection: "connected", endpoint: url });
      await this.refresh();
      this.#listen();
    } catch (error) {
      this.#update({ connection: "offline", error: errorText(error) });
    }
  }

  async refresh(): Promise<void> {
    const client = this.#requireClient();
    try {
      const [sessions, statuses, providers, permissions, questions] = await Promise.all([
        client.session.list({ directory: this.config.directory, limit: 100 }, { throwOnError: true }),
        client.session.status({ directory: this.config.directory }, { throwOnError: true }),
        client.provider.list({ directory: this.config.directory }, { throwOnError: true }),
        client.permission.list({ directory: this.config.directory }, { throwOnError: true }),
        client.question.list({ directory: this.config.directory }, { throwOnError: true }),
      ]);
      const providerData = providers.data;
      const connected = new Set(providerData.connected);
      const availableProviders = providerData.all.filter((provider) => connected.has(provider.id));
      const models = availableProviders.flatMap((provider) => Object.values(provider.models));
      const defaultModel = Object.entries(providerData.default)
        .map(([providerID, modelID]) => models.find((model) => model.providerID === providerID && model.id === modelID))
        .find(Boolean);
      const selectedID = this.#state.selectedID && sessions.data.some((session) => session.id === this.#state.selectedID)
        ? this.#state.selectedID
        : sessions.data.find((session) => !session.parentID)?.id ?? sessions.data[0]?.id;
      this.#update({
        sessions: sessions.data,
        selectedID,
        statuses: statuses.data,
        busy: selectedID ? statuses.data[selectedID]?.type !== "idle" && statuses.data[selectedID] !== undefined : false,
        providers: availableProviders,
        models,
        model: this.#state.model ?? (defaultModel ? { providerID: defaultModel.providerID, modelID: defaultModel.id } : undefined),
        permission: permissions.data[0],
        question: questions.data[0],
        error: undefined,
      });
      if (selectedID) await this.selectSession(selectedID);
      await this.loadWorkspace();
    } catch (error) {
      this.#update({ error: errorText(error) });
    }
  }

  async retry(): Promise<void> {
    this.#events?.abort();
    this.#events = undefined;
    this.#terminals.stop();
    this.#stopped = false;
    await this.connect();
  }

  async createSession(): Promise<void> {
    const result = await this.#requireClient().session.create(
      { directory: this.config.directory, title: "New session" },
      { throwOnError: true },
    );
    this.#upsertSession(result.data);
    await this.selectSession(result.data.id);
  }

  async selectSession(sessionID: string): Promise<void> {
    const status = this.#state.statuses[sessionID];
    this.#update({ selectedID: sessionID, messages: [], loadingMessages: true, loadingOlderMessages: false, hasOlderMessages: false, busy: status !== undefined && status.type !== "idle", error: undefined });
    try {
      const result = await this.#requireClient().session.messages(
        { directory: this.config.directory, sessionID, limit: MESSAGE_PAGE_SIZE },
        { throwOnError: true },
      );
      if (this.#state.selectedID === sessionID) {
        const received = new Set(result.data.map((message) => message.info.id));
        const optimistic = [...this.#optimisticMessages.values()].filter((message) => message.info.sessionID === sessionID && !received.has(message.info.id));
        this.#update({ messages: [...result.data, ...optimistic], loadingMessages: false, hasOlderMessages: result.data.length === MESSAGE_PAGE_SIZE });
        void this.loadSessionContext(sessionID);
        if (!this.#state.busy) void this.#drainQueue(sessionID);
      }
    } catch (error) {
      if (this.#state.selectedID === sessionID) this.#update({ loadingMessages: false, error: errorText(error) });
    }
  }

  async loadOlderMessages(): Promise<number> {
    const sessionID = this.#state.selectedID;
    const before = this.#state.messages[0]?.info.id;
    if (!sessionID || !before || this.#state.loadingOlderMessages || !this.#state.hasOlderMessages) return 0;
    this.#update({ loadingOlderMessages: true });
    try {
      const result = await this.#requireClient().session.messages(
        { directory: this.config.directory, sessionID, limit: MESSAGE_PAGE_SIZE, before },
        { throwOnError: true },
      );
      if (this.#state.selectedID !== sessionID) return 0;
      const existing = new Set(this.#state.messages.map((message) => message.info.id));
      const older = result.data.filter((message) => !existing.has(message.info.id));
      this.#update({
        messages: [...older, ...this.#state.messages],
        hasOlderMessages: result.data.length === MESSAGE_PAGE_SIZE,
        loadingOlderMessages: false,
      });
      return older.length;
    } catch (error) {
      if (this.#state.selectedID === sessionID) this.#update({ loadingOlderMessages: false, error: errorText(error) });
      return 0;
    }
  }

  selectModel(model: Model): void {
    this.#update({ model: { providerID: model.providerID, modelID: model.id }, variant: undefined });
  }

  selectVariant(variant?: string): void {
    this.#update({ variant });
  }

  selectAgent(agent?: string): void {
    this.#update({ agent });
  }

  async loadWorkspace(): Promise<void> {
    const client = this.#requireClient();
    const directory = this.config.directory;
    const path = this.#state.browsePath;
    const [projects, agents, commands, files, fileStatus, mcp, references, resources, terminals] = await Promise.all([
      client.project.list({ directory }, { throwOnError: true }).then((result) => result.data).catch(() => [] as Project[]),
      client.app.agents({ directory }, { throwOnError: true }).then((result) => result.data).catch(() => [] as Agent[]),
      client.command.list({ directory }, { throwOnError: true }).then((result) => result.data).catch(() => [] as Command[]),
      client.file.list({ directory, path }, { throwOnError: true }).then((result) => result.data).catch(() => [] as FileNode[]),
      client.vcs.status({ directory }, { throwOnError: true }).then((result) => result.data).catch(() => [] as VcsFileStatus[]),
      client.mcp.status({ directory }, { throwOnError: true }).then((result) => result.data).catch(() => ({} as Record<string, McpStatus>)),
      client.v2.reference.list({ location: { directory } }, { throwOnError: true }).then((result) => result.data.data).catch(() => [] as ReferenceInfo[]),
      client.experimental.resource.list({ directory }, { throwOnError: true }).then((result) => Object.values(result.data)).catch(() => [] as McpResource[]),
      this.#terminals.list().catch(() => [] as Pty[]),
    ]);
    const visibleAgents = agents.filter((agent) => !agent.hidden && agent.mode !== "subagent");
    this.#update({
      projects,
      agents: visibleAgents,
      mentionAgents: agents.filter((agent) => !agent.hidden && agent.mode !== "primary"),
      agent: this.#state.agent ?? visibleAgents[0]?.name,
      commands,
      files: files.filter((file) => !file.ignored).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1),
      fileStatus,
      mcp,
      references,
      resources,
      terminals,
    });
  }

  async browse(path: string): Promise<void> {
    this.#update({ browsePath: path });
    await this.loadWorkspace();
  }

  async openFile(path: string): Promise<void> {
    const existing = this.#state.openFiles.find((file) => file.path === path);
    this.#update({
      selectedFile: path,
      openFiles: existing
        ? this.#state.openFiles
        : [...this.#state.openFiles, { path, loading: true }],
    });
    if (existing?.content || existing?.loading) return;
    await this.#readFile(path);
  }

  selectOpenFile(path: string): void {
    if (this.#state.openFiles.some((file) => file.path === path)) this.#update({ selectedFile: path });
  }

  closeFile(path: string): void {
    const index = this.#state.openFiles.findIndex((file) => file.path === path);
    if (index < 0) return;
    const openFiles = this.#state.openFiles.filter((file) => file.path !== path);
    const selectedFile = this.#state.selectedFile === path
      ? openFiles[Math.min(index, openFiles.length - 1)]?.path
      : this.#state.selectedFile;
    this.#update({ openFiles, selectedFile });
  }

  async #readFile(path: string): Promise<void> {
    this.#update({
      openFiles: this.#state.openFiles.map((file) => file.path === path ? { ...file, loading: true } : file),
    });
    try {
      const result = await this.#requireClient().file.read(
        { directory: this.config.directory, path },
        { throwOnError: true },
      );
      this.#update({
        openFiles: this.#state.openFiles.map((file) => file.path === path ? { path, content: result.data, loading: false } : file),
      });
    } catch (error) {
      this.#update({
        error: errorText(error),
        openFiles: this.#state.openFiles.map((file) => file.path === path ? { ...file, loading: false } : file),
      });
    }
  }

  async loadSessionContext(sessionID = this.#state.selectedID): Promise<void> {
    if (!sessionID) {
      this.#update({ todos: [], sessionDiffs: [] });
      return;
    }
    const client = this.#requireClient();
    const directory = this.config.directory;
    const [todos, diffs] = await Promise.all([
      client.session.todo({ directory, sessionID }, { throwOnError: true }).then((result) => result.data).catch(() => [] as Todo[]),
      client.session.diff({ directory, sessionID }, { throwOnError: true }).then((result) => result.data).catch(() => [] as SnapshotFileDiff[]),
    ]);
    if (this.#state.selectedID === sessionID) this.#update({ todos, sessionDiffs: diffs });
  }

  async archiveSession(sessionID = this.#state.selectedID): Promise<void> {
    if (!sessionID) return;
    await this.#requireClient().session.update(
      { directory: this.config.directory, sessionID, time: { archived: Date.now() } },
      { throwOnError: true },
    );
    const archived = this.#state.sessions.find((session) => session.id === sessionID);
    const sessions = this.#state.sessions.filter((session) => session.id !== sessionID);
    const fallbackID = archived?.parentID && sessions.some((session) => session.id === archived.parentID)
      ? archived.parentID
      : sessions.find((session) => !session.parentID)?.id;
    this.#update({
      sessions,
      selectedID: fallbackID,
      messages: [],
      todos: [],
      sessionDiffs: [],
      queued: this.#state.queued.filter((item) => item.sessionID !== sessionID),
    });
    if (fallbackID) await this.selectSession(fallbackID);
  }

  async forkSession(messageID?: string): Promise<void> {
    const sessionID = this.#state.selectedID;
    if (!sessionID) return;
    messageID ??= [...this.#state.messages].reverse().find((message) => message.info.role === "user")?.info.id;
    const result = await this.#requireClient().session.fork(
      { directory: this.config.directory, sessionID, messageID },
      { throwOnError: true },
    );
    this.#upsertSession(result.data);
    await this.selectSession(result.data.id);
  }

  async revertLastMessage(): Promise<void> {
    const messageID = [...this.#state.messages].reverse().find((message) => message.info.role === "user")?.info.id;
    if (!messageID) return;
    await this.revertToMessage(messageID);
  }

  async revertToMessage(messageID: string): Promise<void> {
    const sessionID = this.#state.selectedID;
    if (!sessionID) return;
    await this.#requireClient().session.revert(
      { directory: this.config.directory, sessionID, messageID },
      { throwOnError: true },
    );
    await this.refresh();
  }

  #messageDraft(messageID: string): MessageDraft | undefined {
    const message = this.#state.messages.find((item) => item.info.id === messageID);
    if (!message || message.info.role !== "user") return;
    const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
    const files = message.parts.filter((part) => part.type === "file").map((part) => {
      const source = part.source?.type === "file" || part.source?.type === "resource" ? part.source : undefined;
      const value = source?.text.value ?? `@${source?.type === "file" ? source.path : part.filename ?? "attachment"}`;
      const start = source?.text.start ?? text.indexOf(value);
      return {
        path: source?.type === "file" ? source.path : undefined,
        filename: part.filename,
        mime: part.mime,
        url: part.url,
        start: Math.max(0, start),
        end: Math.max(0, start) + value.length,
        text: value,
        resource: source?.type === "resource" ? { clientName: source.clientName, uri: source.uri } : undefined,
      };
    });
    const agents = message.parts.filter((part) => part.type === "agent").map((part) => ({
      name: part.name,
      start: part.source?.start ?? text.indexOf(`@${part.name}`),
      end: part.source?.end ?? text.indexOf(`@${part.name}`) + part.name.length + 1,
      text: part.source?.value ?? `@${part.name}`,
    }));
    return { messageID, text, files, agents, agent: message.info.agent, model: message.info.model, variant: message.info.model.variant };
  }

  async prepareMessageEdit(messageID: string): Promise<MessageDraft | undefined> {
    const draft = this.#messageDraft(messageID);
    if (!draft) return;
    if (this.#state.busy) await this.abort();
    await this.revertToMessage(messageID);
    return draft;
  }

  async retryMessage(messageID: string): Promise<void> {
    const draft = this.#messageDraft(messageID);
    if (!draft) return;
    if (this.#state.busy) await this.abort();
    await this.revertToMessage(messageID);
    await this.send(draft.text, draft.files, { agent: draft.agent, model: draft.model, variant: draft.variant, agents: draft.agents });
  }

  async unrevert(): Promise<void> {
    const sessionID = this.#state.selectedID;
    if (!sessionID) return;
    await this.#requireClient().session.unrevert(
      { directory: this.config.directory, sessionID },
      { throwOnError: true },
    );
    await this.refresh();
  }

  async compact(): Promise<void> {
    const sessionID = this.#state.selectedID;
    const model = this.#state.model;
    if (!sessionID || !model) return;
    this.#update({ busy: true, error: undefined });
    try {
      await this.#requireClient().session.summarize(
        { directory: this.config.directory, sessionID, providerID: model.providerID, modelID: model.modelID },
        { throwOnError: true },
      );
    } catch (error) {
      this.#update({ busy: false, error: errorText(error) });
      throw error;
    }
  }

  async toggleShare(): Promise<string | undefined> {
    const sessionID = this.#state.selectedID;
    if (!sessionID) return;
    const selected = this.#state.sessions.find((session) => session.id === sessionID);
    const result = selected?.share
      ? await this.#requireClient().session.unshare({ directory: this.config.directory, sessionID }, { throwOnError: true })
      : await this.#requireClient().session.share({ directory: this.config.directory, sessionID }, { throwOnError: true });
    this.#upsertSession(result.data);
    return result.data.share?.url;
  }

  async searchFiles(query: string): Promise<string[]> {
    const result = await this.#requireClient().find.files(
      { directory: this.config.directory, query, dirs: "false", limit: 30 },
      { throwOnError: true },
    );
    return result.data;
  }

  async searchMentions(query: string): Promise<MentionSuggestion[]> {
    const files = query ? await this.searchFiles(query).catch(() => []) : [];
    const recent = [this.#state.selectedFile, ...this.#state.openFiles.map((file) => file.path)].filter((path): path is string => Boolean(path));
    return mentionSuggestions({ query, recent, files, agents: this.#state.mentionAgents, references: this.#state.references, resources: this.#state.resources });
  }

  #fileParts(files: FileMention[]) {
    return files.map((file) => {
      const path = file.path;
      const url = file.url ?? (path ? pathToFileURL(resolve(this.config.directory, path)).href : undefined);
      if (!url) throw new Error("an attached file must have a path or URL");
      return {
        type: "file" as const,
        mime: file.mime ?? "text/plain",
        filename: file.filename ?? (path ? basename(path) : "attachment"),
        url,
        ...(file.resource ? {
          source: {
            type: "resource" as const,
            text: { value: file.text, start: file.start, end: file.end },
            clientName: file.resource.clientName,
            uri: file.resource.uri,
          },
        } : path ? {
          source: {
            type: "file" as const,
            path,
            text: { value: file.text, start: file.start, end: file.end },
          },
        } : {}),
      };
    });
  }

  #agentParts(agents: AgentMention[]) {
    return agents.map((agent) => ({
      type: "agent" as const,
      name: agent.name,
      source: { value: agent.text, start: agent.start, end: agent.end },
    }));
  }

  #contextFileParts(contexts: LineSelection[]) {
    const used = new Set<string>();
    return contexts.flatMap((context) => {
      const url = contextFileURL(this.config.directory, context);
      if (used.has(url)) return [];
      used.add(url);
      return [{ type: "file" as const, mime: "text/plain", filename: basename(context.path), url }];
    });
  }

  async send(
    text: string,
    files: FileMention[] = [],
    selection?: { agent?: string; model?: { providerID: string; modelID: string }; variant?: string; contexts?: LineSelection[]; agents?: AgentMention[] },
  ): Promise<void> {
    const sessionID = this.#state.selectedID;
    const contexts = selection?.contexts ?? [];
    if (!sessionID || (!text.trim() && contexts.length === 0)) return;
    if (this.#state.busy) {
      this.#update({
        queued: [...this.#state.queued, {
          kind: "prompt",
          sessionID,
          text,
          files,
          agents: selection?.agents ?? [],
          contexts,
          agent: selection?.agent ?? this.#state.agent,
          model: selection?.model ?? this.#state.model,
          variant: selection?.variant ?? this.#state.variant,
        }],
        queuePaused: false,
      });
      return;
    }
    const messageID = `msg_${randomUUID().replaceAll("-", "")}`;
    const model = selection?.model ?? this.#state.model;
    const agent = selection?.agent ?? this.#state.agent;
    const variant = selection?.variant ?? this.#state.variant;
    const requestParts = [
      ...(text.trim() ? [{ id: `prt_${randomUUID().replaceAll("-", "")}`, type: "text" as const, text: text.trim() }] : []),
      ...this.#fileParts(files).map((part) => ({ id: `prt_${randomUUID().replaceAll("-", "")}`, ...part })),
      ...this.#agentParts(selection?.agents ?? []).map((part) => ({ id: `prt_${randomUUID().replaceAll("-", "")}`, ...part })),
      ...this.#contextFileParts(contexts).map((part) => ({ id: `prt_${randomUUID().replaceAll("-", "")}`, ...part })),
    ];
    const optimistic: MessageItem | undefined = model && agent ? {
      info: { id: messageID, sessionID, role: "user", time: { created: Date.now() }, agent, model: { ...model, ...(variant ? { variant } : {}) } },
      parts: requestParts.map((part) => ({ ...part, sessionID, messageID })) as Part[],
    } : undefined;
    if (optimistic) this.#optimisticMessages.set(messageID, optimistic);
    this.#update({
      busy: true,
      error: undefined,
      ...(optimistic && this.#state.selectedID === sessionID ? { messages: [...this.#state.messages, optimistic] } : {}),
    });
    try {
      await this.#requireClient().session.promptAsync(
        {
          directory: this.config.directory,
          sessionID,
          messageID,
          model,
          agent,
          variant,
          parts: requestParts,
        },
        { throwOnError: true },
      );
    } catch (error) {
      if (this.#optimisticMessages.delete(messageID) && this.#state.selectedID === sessionID) {
        this.#update({ messages: this.#state.messages.filter((message) => message.info.id !== messageID) });
      }
      this.#update({ busy: false, error: errorText(error) });
      throw error;
    }
  }

  async runCommand(command: string, args: string, files: FileMention[] = [], contexts: LineSelection[] = []): Promise<void> {
    const sessionID = this.#state.selectedID;
    if (!sessionID) return;
    if (this.#state.busy) {
      this.#update({ queued: [...this.#state.queued, { kind: "command", sessionID, command, args, files, contexts }] });
      return;
    }
    const model = this.#state.model
      ? `${this.#state.model.providerID}/${this.#state.model.modelID}`
      : undefined;
    this.#update({ busy: true, error: undefined });
    try {
      await this.#requireClient().session.command(
        {
          directory: this.config.directory,
          sessionID,
          command,
          arguments: args,
          agent: this.#state.agent,
          model,
          parts: [...this.#fileParts(files), ...this.#contextFileParts(contexts)],
        },
        { throwOnError: true },
      );
    } catch (error) {
      this.#update({ busy: false, error: errorText(error) });
      throw error;
    }
  }

  async runShell(command: string): Promise<void> {
    const sessionID = this.#state.selectedID;
    if (!sessionID || !command.trim()) return;
    if (this.#state.busy) {
      this.#update({ queued: [...this.#state.queued, { kind: "shell", sessionID, command }] });
      return;
    }
    this.#update({ busy: true, error: undefined });
    try {
      await this.#requireClient().session.shell(
        { directory: this.config.directory, sessionID, command: command.trim(), model: this.#state.model, agent: this.#state.agent },
        { throwOnError: true },
      );
    } catch (error) {
      this.#update({ busy: false, error: errorText(error) });
      throw error;
    }
  }

  removeQueued(index: number): void {
    const queued = this.#state.queued.filter((_, itemIndex) => itemIndex !== index);
    this.#update({ queued, queuePaused: queued.length ? this.#state.queuePaused : false });
  }

  async #drainQueue(sessionID: string): Promise<void> {
    if (this.#drainingQueue || this.#state.queuePaused || this.#state.selectedID !== sessionID || this.#state.busy) return;
    const index = this.#state.queued.findIndex((item) => item.sessionID === sessionID);
    if (index < 0) return;
    this.#drainingQueue = true;
    const item = this.#state.queued[index]!;
    this.#update({ queued: this.#state.queued.filter((_, itemIndex) => itemIndex !== index) });
    try {
      if (item.kind === "prompt") await this.send(item.text, item.files, { contexts: item.contexts, agent: item.agent, model: item.model, variant: item.variant, agents: item.agents });
      if (item.kind === "command") await this.runCommand(item.command, item.args, item.files, item.contexts);
      if (item.kind === "shell") await this.runShell(item.command);
    } catch {
      this.#update({ queued: [item, ...this.#state.queued], queuePaused: true });
    } finally {
      this.#drainingQueue = false;
    }
  }

  async loadTerminals(): Promise<void> {
    await this.#terminals.load();
  }

  async createTerminal(): Promise<void> {
    await this.#terminals.create();
  }

  async selectTerminal(terminal: Pty): Promise<void> {
    await this.#terminals.select(terminal);
  }

  sendTerminal(data: string): void {
    this.#terminals.send(data);
  }

  async removeTerminal(): Promise<void> {
    await this.#terminals.remove();
  }

  async abort(sessionID = this.#state.selectedID): Promise<void> {
    if (!sessionID) return;
    try {
      await this.#requireClient().session.abort(
        { directory: this.config.directory, sessionID },
        { throwOnError: true },
      );
      this.#update({
        statuses: { ...this.#state.statuses, [sessionID]: { type: "idle" } },
        busy: sessionID === this.#state.selectedID ? false : this.#state.busy,
        queuePaused: sessionID === this.#state.selectedID && this.#state.queued.some((item) => item.sessionID === sessionID) ? true : this.#state.queuePaused,
      });
    } catch (error) {
      this.#update({ error: errorText(error) });
      throw error;
    }
  }

  async replyPermission(reply: "once" | "always" | "reject"): Promise<void> {
    const request = this.#state.permission;
    if (!request) return;
    await this.#requireClient().permission.reply(
      { directory: this.config.directory, requestID: request.id, reply },
      { throwOnError: true },
    );
    this.#update({ permission: undefined });
  }

  async replyQuestion(answers: string[][]): Promise<void> {
    const request = this.#state.question;
    if (!request) return;
    await this.#requireClient().question.reply(
      { directory: this.config.directory, requestID: request.id, answers },
      { throwOnError: true },
    );
    this.#update({ question: undefined });
  }

  async rejectQuestion(): Promise<void> {
    const request = this.#state.question;
    if (!request) return;
    await this.#requireClient().question.reject(
      { directory: this.config.directory, requestID: request.id },
      { throwOnError: true },
    );
    this.#update({ question: undefined });
  }

  stop(): void {
    this.#stopped = true;
    this.#events?.abort();
    this.#events = undefined;
    this.#terminals.stop();
    void this.#desktop.dispose();
  }

  #requireClient(): OpencodeClient {
    if (!this.#client) throw new Error("OpenCode is not connected");
    return this.#client;
  }

  #upsertSession(session: Session): void {
    const sessions = [session, ...this.#state.sessions.filter((item) => item.id !== session.id)]
      .sort((a, b) => b.time.updated - a.time.updated);
    this.#update({ sessions });
  }

  #upsertMessage(info: Message): void {
    this.#optimisticMessages.delete(info.id);
    if (info.sessionID !== this.#state.selectedID) return;
    const current = this.#state.messages.find((item) => item.info.id === info.id);
    const next = { info, parts: current?.parts ?? [] };
    const messages = current
      ? this.#state.messages.map((item) => item.info.id === info.id ? next : item)
      : [...this.#state.messages, next];
    this.#update({ messages });
  }

  #upsertPart(part: Part): void {
    if (part.sessionID !== this.#state.selectedID) return;
    if (!this.#state.messages.some((message) => message.info.id === part.messageID)) {
      void this.#loadMessage(part.sessionID, part.messageID);
      return;
    }
    const messages = this.#state.messages.map((message) => {
      if (message.info.id !== part.messageID) return message;
      const exists = message.parts.some((item) => item.id === part.id);
      return { ...message, parts: exists ? message.parts.map((item) => item.id === part.id ? part : item) : [...message.parts, part] };
    });
    this.#update({ messages });
  }

  async #loadMessage(sessionID: string, messageID: string): Promise<void> {
    if (this.#loadingMessageIDs.has(messageID)) return;
    this.#loadingMessageIDs.add(messageID);
    try {
      const result = await this.#requireClient().session.message(
        { directory: this.config.directory, sessionID, messageID },
        { throwOnError: true },
      );
      if (this.#state.selectedID !== sessionID) return;
      const messages = this.#state.messages.some((item) => item.info.id === messageID)
        ? this.#state.messages.map((item) => item.info.id === messageID ? result.data : item)
        : [...this.#state.messages, result.data];
      this.#update({ messages });
    } catch (error) {
      this.#update({ error: errorText(error) });
    } finally {
      this.#loadingMessageIDs.delete(messageID);
    }
  }

  #applyEvent(event: Event): void {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        this.#upsertSession(event.properties.info);
        break;
      case "session.deleted":
        {
          const deleted = this.#state.sessions.find((item) => item.id === event.properties.info.id);
          const sessions = this.#state.sessions.filter((item) => item.id !== event.properties.info.id);
          const selectedWasDeleted = this.#state.selectedID === event.properties.info.id;
          const fallbackID = deleted?.parentID && sessions.some((item) => item.id === deleted.parentID)
            ? deleted.parentID
            : sessions.find((item) => !item.parentID)?.id;
          this.#update({
            sessions,
            selectedID: selectedWasDeleted ? fallbackID : this.#state.selectedID,
            messages: selectedWasDeleted ? [] : this.#state.messages,
          });
          if (selectedWasDeleted && fallbackID) void this.selectSession(fallbackID);
        }
        break;
      case "message.updated":
        this.#upsertMessage(event.properties.info);
        break;
      case "message.removed":
        if (event.properties.sessionID === this.#state.selectedID) {
          this.#update({ messages: this.#state.messages.filter((item) => item.info.id !== event.properties.messageID) });
        }
        break;
      case "message.part.updated":
        this.#upsertPart(event.properties.part);
        break;
      case "message.part.removed":
        if (event.properties.sessionID === this.#state.selectedID) {
          this.#update({
            messages: this.#state.messages.map((message) => message.info.id === event.properties.messageID
              ? { ...message, parts: message.parts.filter((part) => part.id !== event.properties.partID) }
              : message),
          });
        }
        break;
      case "message.part.delta": {
        const properties = event.properties;
        const message = this.#state.messages.find((item) => item.info.id === properties.messageID);
        const part = message?.parts.find((item) => item.id === properties.partID);
        if (part && properties.field in part && typeof part[properties.field as keyof Part] === "string") {
          this.#upsertPart({ ...part, [properties.field]: String(part[properties.field as keyof Part]) + properties.delta } as Part);
        }
        break;
      }
      case "session.status":
        this.#update({ statuses: { ...this.#state.statuses, [event.properties.sessionID]: event.properties.status } });
        if (event.properties.sessionID === this.#state.selectedID) {
          this.#update({ busy: event.properties.status.type !== "idle" });
          if (event.properties.status.type === "idle") void this.#drainQueue(event.properties.sessionID);
        }
        break;
      case "session.idle":
        this.#update({ statuses: { ...this.#state.statuses, [event.properties.sessionID]: { type: "idle" } } });
        if (event.properties.sessionID === this.#state.selectedID) {
          this.#update({ busy: false });
          void this.#drainQueue(event.properties.sessionID);
        }
        break;
      case "session.diff":
        if (event.properties.sessionID === this.#state.selectedID) this.#update({ sessionDiffs: event.properties.diff });
        break;
      case "todo.updated":
        if (event.properties.sessionID === this.#state.selectedID) this.#update({ todos: event.properties.todos });
        break;
      case "file.watcher.updated":
        void this.loadWorkspace();
        if (this.#state.openFiles.some((file) => file.path === event.properties.file)) void this.#readFile(event.properties.file);
        break;
      case "mcp.tools.changed":
        void this.loadWorkspace();
        break;
      case "pty.created":
      case "pty.updated": {
        const terminal = event.properties.info;
        this.#update({
          terminals: [terminal, ...this.#state.terminals.filter((item) => item.id !== terminal.id)],
          terminal: this.#state.terminal?.id === terminal.id ? terminal : this.#state.terminal,
        });
        break;
      }
      case "pty.exited":
        this.#update({
          terminals: this.#state.terminals.map((item) => item.id === event.properties.id ? { ...item, status: "exited", exitCode: event.properties.exitCode } : item),
          terminalConnection: this.#state.terminal?.id === event.properties.id ? "closed" : this.#state.terminalConnection,
        });
        break;
      case "pty.deleted":
        this.#update({ terminals: this.#state.terminals.filter((item) => item.id !== event.properties.id) });
        break;
      case "session.error":
        if (!event.properties.sessionID || event.properties.sessionID === this.#state.selectedID) {
          this.#update({ busy: false, error: event.properties.error ? JSON.stringify(event.properties.error) : "Session failed" });
        }
        break;
      case "permission.asked":
        this.#update({ permission: event.properties });
        break;
      case "permission.replied":
        if (this.#state.permission?.id === event.properties.requestID) this.#update({ permission: undefined });
        break;
      case "question.asked":
        this.#update({ question: event.properties });
        break;
      case "question.replied":
      case "question.rejected":
        if (this.#state.question?.id === event.properties.requestID) this.#update({ question: undefined });
        break;
    }
  }

  #listen(): void {
    this.#events?.abort();
    const controller = new AbortController();
    this.#events = controller;
    void (async () => {
      while (!this.#stopped && !controller.signal.aborted) {
        try {
          const events = await this.#requireClient().event.subscribe(
            { directory: this.config.directory },
            { signal: controller.signal, sseMaxRetryAttempts: 5 },
          );
          for await (const event of events.stream) this.#applyEvent(event);
        } catch (error) {
          if (controller.signal.aborted || this.#stopped) return;
          this.#update({ error: `Event stream: ${errorText(error)}` });
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
    })();
  }
}

export function modelLabel(state: OpenCodeState): string {
  const selected = state.models.find((model) => model.providerID === state.model?.providerID && model.id === state.model?.modelID);
  return selected?.name ?? "Default model";
}
