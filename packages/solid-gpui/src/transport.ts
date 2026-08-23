/**
 * Child-process transport. The Rust host owns the platform event loop, so it
 * has to be the process that lives on the main thread; JavaScript drives it
 * over stdin/stdout with newline-delimited JSON.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { HostMessage, Operation } from "./protocol.js";

/**
 * What the session needs from a host. `Transport` is the real implementation;
 * tests and tooling can supply anything else with the same shape.
 */
export interface HostConnection {
  onMessage(listener: (message: HostMessage) => void): () => void;
  onExit(listener: (code: number | null) => void): () => void;
  send(operations: Operation[]): void;
  close(): void;
}

export interface TransportOptions {
  /** Explicit path to the `solid-gpui-host` binary. */
  hostPath?: string;
  /** Extra arguments forwarded to the host binary. */
  hostArgs?: string[];
  /** Mirrors every line in both directions to stderr. */
  debug?: boolean;
}

const DEV_BUILD_PATHS = [
  "crates/solid-gpui-host/target/release/solid-gpui-host",
  "crates/solid-gpui-host/target/debug/solid-gpui-host",
  "target/release/solid-gpui-host",
  "target/debug/solid-gpui-host",
];

/**
 * Finds the host binary. An explicit path or `SOLID_GPUI_HOST` always wins;
 * otherwise a locally built binary is preferred over one on `PATH` so that
 * working inside this repository does the obvious thing.
 */
export function resolveHostPath(explicit?: string): string {
  const candidate = explicit ?? process.env["SOLID_GPUI_HOST"];
  if (candidate) {
    if (!existsSync(candidate)) {
      throw new Error(`solid-gpui: host binary not found at ${candidate}`);
    }
    return candidate;
  }
  for (const relative of DEV_BUILD_PATHS) {
    const path = resolve(process.cwd(), relative);
    if (existsSync(path)) return path;
  }
  return "solid-gpui-host";
}

export class Transport implements HostConnection {
  #child: ChildProcessByStdio<Writable, Readable, null>;
  #pending = "";
  #debug: boolean;
  #listeners = new Set<(message: HostMessage) => void>();
  #exitListeners = new Set<(code: number | null) => void>();

  constructor(options: TransportOptions = {}) {
    const path = resolveHostPath(options.hostPath);
    this.#debug = options.debug ?? process.env["SOLID_GPUI_DEBUG"] === "1";
    try {
      this.#child = spawn(path, options.hostArgs ?? [], {
        stdio: ["pipe", "pipe", "inherit"],
        env: process.env,
      });
    } catch (cause) {
      throw new Error(`solid-gpui: failed to launch host binary ${path}`, { cause });
    }
    this.#child.on("error", (error) => {
      throw new Error(
        `solid-gpui: host binary ${path} could not be started. Build it with ` +
          `\`cargo build --release --manifest-path crates/solid-gpui-host/Cargo.toml\` ` +
          `or set SOLID_GPUI_HOST.`,
        { cause: error },
      );
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => this.#consume(chunk));
    this.#child.on("exit", (code) => {
      for (const listener of this.#exitListeners) listener(code);
    });
  }

  #consume(chunk: string): void {
    this.#pending += chunk;
    let index: number;
    while ((index = this.#pending.indexOf("\n")) >= 0) {
      const line = this.#pending.slice(0, index);
      this.#pending = this.#pending.slice(index + 1);
      if (!line) continue;
      if (this.#debug) process.stderr.write(`<- ${line}\n`);
      let message: HostMessage;
      try {
        message = JSON.parse(line) as HostMessage;
      } catch {
        process.stderr.write(`solid-gpui: unparsable line from host: ${line}\n`);
        continue;
      }
      for (const listener of this.#listeners) listener(message);
    }
  }

  onMessage(listener: (message: HostMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  send(operations: Operation[]): void {
    if (operations.length === 0 || this.#child.stdin.destroyed) return;
    const line = JSON.stringify(operations);
    if (this.#debug) process.stderr.write(`-> ${line}\n`);
    this.#child.stdin.write(line + "\n");
  }

  close(): void {
    if (!this.#child.stdin.destroyed) this.#child.stdin.end();
  }

  kill(): void {
    this.#child.kill();
  }
}
