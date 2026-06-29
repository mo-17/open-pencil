# Tauri GUI automation

OpenPencil supports two debug-only Tauri automation bridges for local GUI testing on macOS:

- `hypothesi/mcp-server-tauri` for AI-assisted development inspection and interaction.
- `danielraffel/tauri-webdriver` for W3C WebDriver-style E2E automation.

Both Rust plugins are registered only in `debug_assertions` builds. The default Tauri config does not enable `withGlobalTauri`; use the automation config when a tool needs `window.__TAURI__`.

## Hypothesi MCP bridge

Use this path when Codex or another MCP client needs screenshots, DOM snapshots, console logs, JS execution, IPC monitoring, or direct webview interaction.

Start the app with the automation config:

```sh
bun run tauri:automation:dev
```

In another terminal, start the MCP server for your MCP client:

```sh
bun run mcp:tauri
```

For direct CLI checks without an MCP client:

```sh
bun run tauri:mcp:session
bun run tauri:mcp:screenshot
```

The bridge uses port `9223` by default. If the session cannot connect, verify that the Tauri app was started with `bun run tauri:automation:dev`, not plain `bun run tauri dev`.

### Lowcode preview ACK runbook

Use this sequence for a local, real Tauri webview ACK of the lowcode preview pane. It verifies the debug app, the MCP bridge, the window, the webview DOM, and a screenshot path without relying on the Playwright Tauri mock.

Terminal 1:

```sh
bun run tauri:automation:dev
```

Terminal 2:

```sh
bun run tauri:mcp:lowcode-preview-ack
```

This helper runs the same checks listed below in sequence and writes the screenshot to `test-results/tauri-mcp-screenshot.png` by default. Use `--skip-screenshot` for a non-image smoke, or set `TAURI_MCP_BIN=/path/to/tauri-mcp` when you want to avoid the `bunx` fallback.

For manual debugging, run the underlying steps one at a time:

```sh
bunx tauri-mcp driver-session start --port 9223
bunx tauri-mcp driver-session status
bunx tauri-mcp ipc-get-backend-state
bunx tauri-mcp manage-window --action list
bunx tauri-mcp webview-dom-snapshot --type structure
bunx tauri-mcp webview-execute-js --script "(() => ({ hasTauri: Boolean(window.__TAURI__), hasLowcodePreview: Boolean(document.querySelector('#lowcode-preview')), toolbarText: document.querySelector('#lowcode-preview')?.textContent?.slice(0, 200) ?? null }))()"
bunx tauri-mcp webview-get-styles --selector '#lowcode-preview' --properties display,visibility,width,height
bunx tauri-mcp webview-wait-for --type selector --value '#lowcode-preview' --timeout 5000
bunx tauri-mcp webview-screenshot --file test-results/tauri-mcp-screenshot.png
```

Expected signals:

- `driver-session status` returns `connected: true` for `net.dannote.open-pencil` on port `9223`.
- `ipc-get-backend-state` returns `OpenPencil`, debug macOS environment details, and at least one visible window.
- `manage-window --action list` includes the focused `main` window at `http://localhost:1420/`.
- `webview-execute-js` returns `hasTauri: true` and `hasLowcodePreview: true`.
- `webview-get-styles` reports `#lowcode-preview` as visible, usually `display: flex` and `visibility: visible`.
- `webview-screenshot` writes to `test-results/tauri-mcp-screenshot.png`. `test-results/` is ignored and should not be committed.

Run the session commands sequentially. Running `driver-session start` and `webview-screenshot` in parallel can fail because the screenshot process may not see the active session yet.

## Tauri WebDriver

Use this path when you want repeatable WebDriverIO/Selenium-style E2E tests for the Tauri desktop app.

Install the macOS WebDriver server once:

```sh
bun run tauri:webdriver:install
```

Start the normal frontend/Tauri automation build:

```sh
bun run tauri:automation:dev
```

In another terminal, keep the WebDriver server running:

```sh
bun run tauri:webdriver
```

The server listens on port `4444`. The debug app binary is:

```sh
desktop/target/debug/OpenPencil
```

If you use `danielraffel/mcp-tauri-automation`, set:

```sh
TAURI_APP_PATH=/Users/huangzhibin/vscode/open-pencil-master/desktop/target/debug/OpenPencil
TAURI_WEBDRIVER_PORT=4444
```

That MCP server is not vendored into this repository because it is distributed as a GitHub source project rather than a published package. Clone and build it outside the repo, then point your MCP client at its `dist/index.js`.

## Recommended split

- Use `hypothesi/mcp-server-tauri` for interactive AI debugging and GUI ACK checks.
- Use `tauri-webdriver` for durable automated tests that should live in CI or a repeatable local test suite.
- Use OpenPencil's own `packages/mcp` for scene-graph/domain-level assertions and edits.
