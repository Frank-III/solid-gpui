#!/usr/bin/env node
/**
 * Wraps a built host binary in the npm package for its platform.
 *
 * The host cannot go to crates.io: it depends on gpui by git revision, and
 * crates.io rejects git dependencies. So it travels as a prebuilt binary
 * instead, one small package per platform, each marked with the `os` and `cpu`
 * it is for. A package manager installs only the one that matches, and
 * `solid-gpui` lists them all as optional dependencies so the others are skipped
 * rather than failing.
 *
 *   node scripts/package-host.mjs --target darwin-arm64 --binary path/to/host
 *
 * Writes to `dist/npm/<target>/`, ready for `npm publish`.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The targets that are published, and what npm calls their platform and CPU. */
export const TARGETS = {
  "darwin-arm64": { os: "darwin", cpu: "arm64", rust: "aarch64-apple-darwin" },
  "darwin-x64": { os: "darwin", cpu: "x64", rust: "x86_64-apple-darwin" },
  "linux-x64": { os: "linux", cpu: "x64", rust: "x86_64-unknown-linux-gnu" },
  "linux-arm64": { os: "linux", cpu: "arm64", rust: "aarch64-unknown-linux-gnu" },
};

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function read(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function packageHost({ target, binary, version, out }) {
  const spec = TARGETS[target];
  if (!spec) {
    throw new Error(`unknown target ${target}, expected one of ${Object.keys(TARGETS).join(", ")}`);
  }
  if (!existsSync(binary)) {
    throw new Error(`no binary at ${binary}`);
  }

  const directory = out ?? join(root, "dist", "npm", target);
  mkdirSync(directory, { recursive: true });

  const manifest = {
    name: `@solid-gpui/host-${target}`,
    version,
    description: `The solid-gpui host binary for ${spec.os} ${spec.cpu}`,
    license: "MIT",
    // What makes a package manager skip the platforms that do not apply.
    os: [spec.os],
    cpu: [spec.cpu],
    files: ["solid-gpui-host", "README.md"],
    repository: { type: "git", url: "git+https://github.com/lxsmnsyc/solid-gpui.git" },
  };
  writeFileSync(join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(directory, "README.md"),
    [
      `# @solid-gpui/host-${target}`,
      "",
      `The [solid-gpui](https://www.npmjs.com/package/solid-gpui) host binary for ${spec.os} ${spec.cpu}.`,
      "",
      "Install `solid-gpui` instead. It depends on this package optionally, so",
      "only the binary for the machine doing the installing is downloaded.",
      "",
    ].join("\n"),
  );

  const destination = join(directory, "solid-gpui-host");
  copyFileSync(binary, destination);
  chmodSync(destination, 0o755);
  return directory;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = argument("target");
  const binary = argument("binary") ?? join(root, "crates/solid-gpui-host/target/release/solid-gpui-host");
  const version = argument("version") ?? read(join(root, "packages/solid-gpui/package.json")).version;
  if (!target) {
    console.error("usage: package-host.mjs --target <platform-arch> [--binary <path>] [--version <version>]");
    process.exit(1);
  }
  const directory = packageHost({ target, binary: resolve(binary), version });
  console.log(directory);
}
