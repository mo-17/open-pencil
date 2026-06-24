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
