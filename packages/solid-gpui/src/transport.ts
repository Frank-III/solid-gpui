/**
 * Child-process transport. The Rust host owns the platform event loop, so it
 * has to be the process that lives on the main thread; JavaScript drives it
 * over stdin/stdout with newline-delimited JSON.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

/** The package holding the prebuilt binary for the machine this is running on. */
export function hostPackageName(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return `@solid-gpui/host-${platform}-${arch}`;
}

/**
 * Finds the binary that was installed with the package.
 *
 * The host is published as one small package per platform, listed in this
 * package's optional dependencies; a package manager installs only the one whose
 * `os` and `cpu` match, so at most one of them is ever present.
 */
function installedHostPath(): string | null {
  const name = hostPackageName();
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve(`${name}/solid-gpui-host`);
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * Finds the host binary.
 *
 * An explicit path or `SOLID_GPUI_HOST` always wins. A locally built binary
 * comes next, so that rebuilding the host inside this repository takes effect
 * without uninstalling anything; the search walks up from the working directory,
 * because an application is usually run from its own folder rather than from the
 * root of the checkout that holds the build. After that comes the binary
 * installed alongside the package, and finally whatever is on `PATH`.
 */
export function resolveHostPath(explicit?: string): string {
  const candidate = explicit ?? process.env["SOLID_GPUI_HOST"];
  if (candidate) {
    const path = resolve(process.cwd(), candidate);
    if (!existsSync(path)) {
      throw new Error(`solid-gpui: host binary not found at ${candidate}`);
    }
    return path;
  }
  let directory = process.cwd();
  for (;;) {
    for (const relative of DEV_BUILD_PATHS) {
      const path = resolve(directory, relative);
      if (existsSync(path)) return path;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return installedHostPath() ?? "solid-gpui-host";
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
