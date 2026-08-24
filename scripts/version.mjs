#!/usr/bin/env node
/**
 * Puts one version on everything that ships.
 *
 * The JavaScript package and the host binary talk over a positional wire
 * protocol with no version in it, so a mismatched pair does not fail loudly, it
 * fails strangely. Keeping the numbers in lockstep, and pinning the optional
 * dependencies exactly, is what stops that pairing from ever happening.
 *
 *   node scripts/version.mjs 0.2.0
 *   node scripts/version.mjs --check
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TARGETS } from "./package-host.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = join(root, "packages/solid-gpui/package.json");
const cargoToml = join(root, "crates/solid-gpui-host/Cargo.toml");

function setVersion(version) {
  const manifest = JSON.parse(readFileSync(packageJson, "utf8"));
  manifest.version = version;
  manifest.optionalDependencies = Object.fromEntries(
    Object.keys(TARGETS).map((target) => [`@solid-gpui/host-${target}`, version]),
  );
  writeFileSync(packageJson, `${JSON.stringify(manifest, null, 2)}\n`);

  const cargo = readFileSync(cargoToml, "utf8");
  writeFileSync(cargoToml, cargo.replace(/^version = ".*"$/m, `version = "${version}"`));
}

function versions() {
  const manifest = JSON.parse(readFileSync(packageJson, "utf8"));
  const cargo = readFileSync(cargoToml, "utf8").match(/^version = "(.*)"$/m)?.[1];
  const optional = manifest.optionalDependencies ?? {};
  return { package: manifest.version, cargo, optional };
}

function check() {
  const { package: js, cargo, optional } = versions();
  const problems = [];
  if (js !== cargo) problems.push(`package.json is ${js}, Cargo.toml is ${cargo}`);
  for (const target of Object.keys(TARGETS)) {
    const name = `@solid-gpui/host-${target}`;
    if (optional[name] !== js) {
      problems.push(`${name} is pinned to ${optional[name] ?? "nothing"}, expected ${js}`);
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(`everything is at ${js}`);
}

const argument = process.argv[2];
if (!argument || argument === "--check") {
  check();
} else {
  setVersion(argument);
  console.log(`set everything to ${argument}`);
}
