import path from "node:path";

export interface DesktopConfig {
  directory: string;
  url?: string;
  username: string;
  password?: string;
  spawn: boolean;
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function loadConfig(): DesktopConfig {
  const directory = path.resolve(argument("directory") ?? process.env["OPENCODE_DIRECTORY"] ?? process.cwd());
  const url = argument("url") ?? process.env["OPENCODE_URL"];
  const password = argument("password") ?? process.env["OPENCODE_PASSWORD"];
  return {
    directory,
    url,
    username: process.env["OPENCODE_USERNAME"] ?? "opencode",
    password,
    spawn: !url && process.env["OPENCODE_NO_SPAWN"] !== "1",
  };
}
