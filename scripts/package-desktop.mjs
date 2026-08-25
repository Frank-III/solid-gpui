#!/usr/bin/env node

import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TARGETS } from "./package-host.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function copyExecutable(source, destination) {
  if (!existsSync(source)) throw new Error(`missing executable: ${source}`);
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
}

function copyNodeLicense(node, destination) {
  const directory = dirname(resolve(node));
  const source = [
    join(directory, "..", "LICENSE"),
    join(directory, "..", "LICENSE.md"),
    "/usr/local/LICENSE",
  ].find(existsSync);
  if (!source) throw new Error(`could not find the Node.js license beside ${node}`);
  copyFileSync(source, destination);
}

function launcher(resources) {
  return `#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/${resources}" && pwd)"
export PATH="$HOME/.opencode/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export SOLID_GPUI_HOST="$ROOT/solid-gpui-host"
if [ "$PWD" = "/" ]; then cd "$HOME"; fi
exec "$ROOT/node" "$ROOT/app/app.js" "$@"
`;
}

function archive(directory, archivePath) {
  const result = spawnSync("tar", ["-czf", archivePath, "-C", dirname(directory), basename(directory)], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`tar failed with status ${result.status}`);
}

export function packageDesktop({ target, binary, node = process.execPath, out }) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`unknown target ${target}, expected one of ${Object.keys(TARGETS).join(", ")}`);
  const app = join(root, "apps", "opencode-desktop", "dist");
  if (!existsSync(join(app, "app.js"))) throw new Error("desktop build missing; run pnpm --filter opencode-desktop build");

  const output = resolve(out ?? join(root, "dist", "desktop"));
  mkdirSync(output, { recursive: true });
  const name = `opencode-solid-gpui-${target}`;
  const directory = join(output, spec.os === "darwin" ? "OpenCode Solid GPUI.app" : name);
  rmSync(directory, { recursive: true, force: true });

  if (spec.os === "darwin") {
    const contents = join(directory, "Contents");
    const resources = join(contents, "Resources");
    mkdirSync(join(contents, "MacOS"), { recursive: true });
    mkdirSync(resources, { recursive: true });
    cpSync(app, join(resources, "app"), { recursive: true });
    copyExecutable(binary, join(resources, "solid-gpui-host"));
    copyExecutable(node, join(resources, "node"));
    copyNodeLicense(node, join(resources, "NODE-LICENSE"));
    copyFileSync(join(root, "LICENSE"), join(resources, "LICENSE"));
    writeFileSync(join(resources, "README.txt"), readFileSync(join(root, "apps", "opencode-desktop", "DISTRIBUTION.md"), "utf8"));
    writeFileSync(join(contents, "MacOS", "opencode-solid-gpui"), launcher("../Resources"));
    chmodSync(join(contents, "MacOS", "opencode-solid-gpui"), 0o755);
    writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>opencode-solid-gpui</string>
  <key>CFBundleIdentifier</key><string>dev.solid-gpui.opencode</string>
  <key>CFBundleName</key><string>OpenCode Solid GPUI</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict></plist>
`);
  } else {
    mkdirSync(join(directory, "app"), { recursive: true });
    cpSync(app, join(directory, "app"), { recursive: true });
    copyExecutable(binary, join(directory, "solid-gpui-host"));
    copyExecutable(node, join(directory, "node"));
    copyNodeLicense(node, join(directory, "NODE-LICENSE"));
    writeFileSync(join(directory, "opencode-solid-gpui"), launcher("."));
    chmodSync(join(directory, "opencode-solid-gpui"), 0o755);
    copyFileSync(join(root, "LICENSE"), join(directory, "LICENSE"));
    writeFileSync(join(directory, "README.txt"), readFileSync(join(root, "apps", "opencode-desktop", "DISTRIBUTION.md"), "utf8"));
  }

  const archivePath = join(output, `${name}.tar.gz`);
  rmSync(archivePath, { force: true });
  archive(directory, archivePath);
  return archivePath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = argument("target");
  const binary = resolve(argument("binary") ?? join(root, "crates", "solid-gpui-host", "target", "release", "solid-gpui-host"));
  if (!target) {
    console.error("usage: package-desktop.mjs --target <platform-arch> [--binary <path>] [--node <path>] [--out <directory>]");
    process.exit(1);
  }
  console.log(packageDesktop({ target, binary, node: argument("node"), out: argument("out") }));
}
