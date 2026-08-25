import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { createOpencodeServer } from "@opencode-ai/sdk/v2";
import type { DesktopConfig } from "./config.js";

class OpenCodeEndpoint extends Context.Service<OpenCodeEndpoint, { readonly url: string }>()("opencode-solid-gpui/OpenCodeEndpoint") {}

const error = (cause: unknown) => cause instanceof Error ? cause : new Error(String(cause));

/** Effect-owned desktop lifecycle resources. Solid remains responsible for UI state. */
export class DesktopRuntime {
  #runtime?: ManagedRuntime.ManagedRuntime<OpenCodeEndpoint, unknown>;

  constructor(private readonly config: DesktopConfig) {}

  endpoint(): Promise<string> {
    this.#runtime ??= ManagedRuntime.make(this.#layer());
    return this.#runtime.runPromise(Effect.gen(function* () { return (yield* OpenCodeEndpoint).url; }));
  }

  async dispose(): Promise<void> {
    const runtime = this.#runtime;
    this.#runtime = undefined;
    await runtime?.dispose();
  }

  #layer() {
    const fallback = "http://127.0.0.1:4096";
    const configured = this.config.url;
    const resolve = configured
      ? Effect.succeed(configured)
      : !this.config.spawn
        ? Effect.succeed(fallback)
        : Effect.tryPromise({
            try: async () => {
              const response = await fetch(new URL("/global/health", fallback), {
                headers: this.config.password
                  ? { Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}` }
                  : undefined,
              });
              if (!response.ok) throw new Error(`OpenCode health check returned HTTP ${response.status}`);
            },
            catch: error,
          }).pipe(
            Effect.as(fallback),
            Effect.catch(() => Effect.acquireRelease(
              Effect.tryPromise({
                try: () => createOpencodeServer({ hostname: "127.0.0.1", port: 0, timeout: 15_000 }),
                catch: error,
              }),
              (server) => Effect.sync(() => server.close()),
            ).pipe(Effect.map((server) => server.url))),
          );
    return Layer.effect(OpenCodeEndpoint, resolve.pipe(Effect.map((url) => OpenCodeEndpoint.of({ url }))));
  }
}
