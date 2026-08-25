import type { OpencodeClient, Pty } from "@opencode-ai/sdk/v2";
import XtermHeadless from "@xterm/headless";
import type { Terminal as HeadlessTerminalType } from "@xterm/headless";

const { Terminal: HeadlessTerminal } = XtermHeadless;

export interface TerminalState {
  endpoint: string;
  terminals: Pty[];
  terminal?: Pty;
  terminalOutput: string;
  terminalConnection: "closed" | "connecting" | "open" | "error";
}

interface TerminalManagerOptions {
  directory: string;
  client: () => OpencodeClient;
  state: () => TerminalState;
  update: (patch: Partial<TerminalState> & { error?: string }) => void;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class TerminalManager {
  #socket?: WebSocket;
  #cursor?: number;
  #emulator?: HeadlessTerminalType;

  constructor(private readonly options: TerminalManagerOptions) {}

  async list(): Promise<Pty[]> {
    const result = await this.options.client().v2.pty.list(
      { location: { directory: this.options.directory } },
      { throwOnError: true },
    );
    return result.data.data;
  }

  async load(): Promise<void> {
    this.options.update({ terminals: await this.list() });
  }

  async create(): Promise<void> {
    this.#socket?.close();
    const result = await this.options.client().v2.pty.create(
      { location: { directory: this.options.directory }, title: "OpenCode Desktop" },
      { throwOnError: true },
    );
    const terminal = result.data.data;
    this.#resetEmulator();
    this.options.update({
      terminal,
      terminals: [terminal, ...this.options.state().terminals.filter((item) => item.id !== terminal.id)],
      terminalOutput: "",
      terminalConnection: "connecting",
    });
    await this.#connect(terminal);
  }

  async select(terminal: Pty): Promise<void> {
    const state = this.options.state();
    if (terminal.id === state.terminal?.id && state.terminalConnection === "open") return;
    this.#socket?.close();
    this.#resetEmulator();
    this.options.update({ terminal, terminalOutput: "", terminalConnection: "connecting" });
    await this.#connect(terminal);
  }

  send(data: string): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(data);
  }

  async remove(): Promise<void> {
    const terminal = this.options.state().terminal;
    if (!terminal) return;
    this.stop();
    await this.options.client().v2.pty.remove(
      { location: { directory: this.options.directory }, ptyID: terminal.id },
      { throwOnError: true },
    );
    const terminals = this.options.state().terminals.filter((item) => item.id !== terminal.id);
    this.options.update({ terminals, terminal: undefined, terminalOutput: "", terminalConnection: "closed" });
  }

  stop(): void {
    this.#socket?.close();
    this.#socket = undefined;
    this.#emulator?.dispose();
    this.#emulator = undefined;
  }

  #resetEmulator(): void {
    this.#cursor = undefined;
    this.#emulator?.dispose();
    this.#emulator = new HeadlessTerminal({ cols: 120, rows: 40, scrollback: 5_000, allowProposedApi: true });
  }

  async #connect(terminal: Pty): Promise<void> {
    try {
      const result = await this.options.client().v2.pty.connectToken(
        { location: { directory: this.options.directory }, ptyID: terminal.id },
        { throwOnError: true, headers: { "x-opencode-ticket": "1" } },
      );
      if (this.options.state().terminal?.id !== terminal.id) return;
      const url = new URL(`/api/pty/${encodeURIComponent(terminal.id)}/connect`, this.options.state().endpoint);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("location[directory]", this.options.directory);
      url.searchParams.set("ticket", result.data.data.ticket);
      if (this.#cursor !== undefined) url.searchParams.set("cursor", String(this.#cursor));
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      this.#socket = socket;
      socket.addEventListener("open", () => {
        if (this.options.state().terminal?.id === terminal.id) this.options.update({ terminalConnection: "open" });
      });
      socket.addEventListener("message", (event) => {
        if (this.options.state().terminal?.id !== terminal.id) return;
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          if (bytes[0] === 0) {
            const metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as { cursor?: number };
            if (Number.isSafeInteger(metadata.cursor)) this.#cursor = metadata.cursor;
            return;
          }
          this.#append(new TextDecoder().decode(bytes));
          return;
        }
        this.#append(String(event.data));
      });
      socket.addEventListener("close", () => {
        if (this.options.state().terminal?.id === terminal.id && this.#socket === socket) {
          this.options.update({ terminalConnection: "closed" });
        }
      });
      socket.addEventListener("error", () => {
        if (this.options.state().terminal?.id === terminal.id) this.options.update({ terminalConnection: "error" });
      });
    } catch (error) {
      this.options.update({ terminalConnection: "error", error: errorText(error) });
      throw error;
    }
  }

  #append(chunk: string): void {
    const emulator = this.#emulator;
    if (!emulator) return;
    emulator.write(chunk, () => {
      const buffer = emulator.buffer.active;
      const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? "");
      while (lines.length > 1 && !lines.at(-1)) lines.pop();
      this.options.update({ terminalOutput: lines.slice(-1_000).join("\n").slice(-100_000) });
    });
  }
}
