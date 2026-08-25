import { spawn } from "node:child_process";
import type { DesktopConfig } from "./config.js";

/** Opens another project without tearing down the current desktop workspace. */
export function launchProjectWindow(directory: string, config: DesktopConfig): void {
  const entry = process.argv[1];
  if (!entry) throw new Error("desktop entrypoint is unavailable");
  const child = spawn(process.execPath, [entry, `--directory=${directory}`], {
    cwd: directory,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...(config.url ? { OPENCODE_URL: config.url } : {}),
      ...(config.password ? { OPENCODE_PASSWORD: config.password } : {}),
      OPENCODE_USERNAME: config.username,
    },
  });
  child.unref();
}
