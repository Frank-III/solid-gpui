# Releasing

Two artefacts ship: the `solid-gpui` package on npm, and the host binary. They
have to arrive together, because the wire protocol between them is positional
and carries no version of its own. A mismatched pair does not fail loudly, it
fails strangely.

## Why the crate is not published

`solid-gpui-host` depends on `gpui` and `gpui_platform` by git revision, and
crates.io rejects any crate with a git dependency. `gpui_platform`, which owns
the application entry point, is not on crates.io at all. So the host travels as a
prebuilt binary rather than as source, and the crate is marked `publish = false`.

## How the binary travels

One small npm package per platform, each holding a single binary and marked with
the `os` and `cpu` it is for:

```
@solid-gpui/host-darwin-arm64
@solid-gpui/host-darwin-x64
@solid-gpui/host-linux-x64
@solid-gpui/host-linux-arm64
```

`solid-gpui` lists all four as **optional** dependencies, pinned to its own exact
version. A package manager installs only the one whose `os` and `cpu` match and
skips the rest, so a user downloads one binary rather than four, and an
unsupported platform gets a warning rather than a failed install.

At runtime `resolveHostPath` looks for the binary in this order: `SOLID_GPUI_HOST`
or an explicit path, a locally built binary found by walking up from the working
directory, the installed platform package, then the bare name on `PATH`. The
local build comes first on purpose, so rebuilding the host inside this repository
takes effect without uninstalling anything.

## Cutting a release

```sh
node scripts/version.mjs 0.2.0   # package.json, Cargo.toml and the four pins
pnpm build && pnpm test
git commit -am "release 0.2.0" && git tag v0.2.0 && git push --tags
```

The tag starts [.github/workflows/release.yml](../.github/workflows/release.yml),
which builds the host on a runner per platform, wraps each binary with
`scripts/package-host.mjs`, and then publishes. Order matters: the host packages
go first, then `solid-gpui`, which pins them exactly. Published the other way
round, `solid-gpui` would briefly install into a broken state.

`node scripts/version.mjs --check` runs in CI before anything is published and
fails if the crate, the package and the pins have drifted apart.

Run the workflow by hand with `dry-run` to build everything without publishing.

## Doing it by hand

```sh
pnpm build:host
node scripts/package-host.mjs --target darwin-arm64
npm publish dist/npm/darwin-arm64 --access public
npm publish packages/solid-gpui --access public
```

`--binary` overrides which binary is wrapped, which is what the cross-compiled
CI builds use.

## Things to know

- **The binary is large.** gpui links a lot; `strip = true` is set on the release
  profile. Each user downloads only their own platform.
- **The first CI build is slow.** It clones several gigabytes of Zed and compiles
  gpui. The workflow caches `~/.cargo/git` and the target directory per runner.
- **Signing.** Files installed by npm are not quarantined by Gatekeeper, so an
  unsigned host runs fine as a dependency. Shipping an actual `.app` built on top
  of this is a separate signing and notarisation problem.
