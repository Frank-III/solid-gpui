# OpenCode Solid GPUI desktop bundle

This bundle includes the Node.js runtime, the Solid application, and the native
GPUI host. It requires the `opencode` CLI to be installed.

Run it from the project you want OpenCode to work on:

```sh
/path/to/opencode-solid-gpui --directory "$PWD"
```

The launcher also finds OpenCode in `~/.opencode/bin`, `/opt/homebrew/bin`, and
`/usr/local/bin`. To connect to an existing server, set `OPENCODE_URL` and,
when needed, `OPENCODE_PASSWORD`.

macOS bundles are currently unsigned. On first launch, Control-click the app,
choose Open, and confirm. Linux requires X11 or Wayland and the system libraries
normally needed by GPUI.
