import { describe, expect, test } from 'bun:test'

import {
  resolveBrowserRpcTimeoutMs,
  resolveStdioRpcTimeoutMs,
  rpcTimeoutMessage
} from '#mcp/rpc-timeout'

describe('MCP RPC timeout policy', () => {
  test('keeps ordinary requests bounded and gives stdio extra time', () => {
    const request = { command: 'get_selection', args: {} }
    const browserTimeoutMs = resolveBrowserRpcTimeoutMs(request)
    const stdioTimeoutMs = resolveStdioRpcTimeoutMs(request)

    expect(browserTimeoutMs).toBe(30_000)
    expect(stdioTimeoutMs).toBe(50_000)
    expect(stdioTimeoutMs).toBeGreaterThan(browserTimeoutMs)
  })

  test('gives every tool request at least 60 seconds at the browser layer', () => {
    for (const name of ['render', 'export_image', 'get_current_page']) {
      const request = { command: 'tool', args: { name, args: {} } }
      const browserTimeoutMs = resolveBrowserRpcTimeoutMs(request)
      const stdioTimeoutMs = resolveStdioRpcTimeoutMs(request)

      expect(browserTimeoutMs).toBe(120_000)
      expect(browserTimeoutMs).toBeGreaterThanOrEqual(60_000)
      expect(stdioTimeoutMs).toBe(140_000)
      expect(stdioTimeoutMs).toBeGreaterThan(browserTimeoutMs)
    }
  })

  test('reports the resolved deadline in seconds', () => {
    expect(rpcTimeoutMessage(resolveBrowserRpcTimeoutMs({ command: 'tool' }))).toBe(
      'RPC timeout (120s)'
    )
    expect(rpcTimeoutMessage(resolveStdioRpcTimeoutMs({ command: 'tool' }))).toBe(
      'RPC timeout (140s)'
    )
  })
})
