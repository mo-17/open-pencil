const BROWSER_DEFAULT_TIMEOUT_MS = 30_000
const BROWSER_TOOL_TIMEOUT_MS = 120_000
// The browser bridge may wait up to 10 seconds for the desktop app before
// starting its own RPC deadline. Keep another 10 seconds for transport and
// response overhead so the outer stdio bridge never wins that timeout race.
const STDIO_TIMEOUT_GRACE_MS = 20_000

export function resolveBrowserRpcTimeoutMs(body: Record<string, unknown>): number {
  return body.command === 'tool' ? BROWSER_TOOL_TIMEOUT_MS : BROWSER_DEFAULT_TIMEOUT_MS
}

export function resolveStdioRpcTimeoutMs(body: Record<string, unknown>): number {
  return resolveBrowserRpcTimeoutMs(body) + STDIO_TIMEOUT_GRACE_MS
}

export function rpcTimeoutMessage(timeoutMs: number): string {
  return `RPC timeout (${timeoutMs / 1000}s)`
}
