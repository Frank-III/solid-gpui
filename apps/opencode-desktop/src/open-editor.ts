import { spawn } from "node:child_process";
import { basename, isAbsolute, relative, resolve } from "node:path";

export interface EditorLaunch {
  command: string;
  args: string[];
}

function launchFor(command: string, path: string, line?: number): EditorLaunch {
  const name = basename(command).replace(/\.exe$/i, "").toLowerCase();
  if (["code", "code-insiders", "cursor", "windsurf"].includes(name)) {
    return { command, args: ["-g", line ? `${path}:${line}` : path] };
  }
  if (["zed", "subl", "sublime_text"].includes(name)) {
    return { command, args: [line ? `${path}:${line}` : path] };
  }
  if (["idea", "webstorm", "pycharm", "rustrover"].includes(name)) {
    return { command, args: line ? ["--line", String(line), path] : [path] };
  }
  return { command, args: [path] };
}

export function editorLaunches(
  path: string,
  line?: number,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): EditorLaunch[] {
  const configured = environment["OPENCODE_EDITOR"] || environment["VISUAL"] || environment["EDITOR"];
  const commands = [
    configured,
    "code",
    "cursor",
    "zed",
    ...(platform === "darwin" ? ["open"] : platform === "win32" ? ["explorer.exe"] : ["xdg-open"]),
  ].filter((command, index, all): command is string => Boolean(command) && all.indexOf(command) === index);
  return commands.map((command) => launchFor(command, path, line));
}

export function projectFilePath(directory: string, path: string): string {
  const root = resolve(directory);
  const target = resolve(root, path);
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(child)) {
    throw new Error("File is outside the project directory");
  }
  return target;
}

export function externalURLLaunch(url: string, platform: NodeJS.Platform = process.platform): EditorLaunch {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only HTTP(S) URLs can be opened");
  return {
    command: platform === "darwin" ? "open" : platform === "win32" ? "explorer.exe" : "xdg-open",
    args: [parsed.href],
  };
}

function launch(spec: EditorLaunch): Promise<boolean> {
  return new Promise((resolveLaunch) => {
    const child = spawn(spec.command, spec.args, { detached: true, stdio: "ignore" });
    child.once("spawn", () => { child.unref(); resolveLaunch(true); });
    child.once("error", () => resolveLaunch(false));
  });
}

/** Opens a trusted project file in the configured or first available desktop editor. */
export async function openProjectFile(directory: string, path: string, line?: number): Promise<string> {
  const target = projectFilePath(directory, path);
  for (const spec of editorLaunches(target, line)) {
    if (await launch(spec)) return basename(spec.command);
  }
  throw new Error("No supported editor was found. Set OPENCODE_EDITOR to an editor executable.");
}

export async function openExternalURL(url: string): Promise<void> {
  if (!await launch(externalURLLaunch(url))) throw new Error("The system browser could not be opened");
}
