import { describe, expect, test } from 'bun:test'

import {
  resolveBrowserRPCTimeoutMs,
  resolveStdioRPCTimeoutMs,
  rpcTimeoutMessage
} from '#mcp/rpc-timeout'

describe('MCP RPC timeout policy', () => {
  test('keeps ordinary requests bounded and gives stdio extra time', () => {
    const request = { command: 'get_selection', args: {} }
    const browserTimeoutMs = resolveBrowserRPCTimeoutMs(request)
    const stdioTimeoutMs = resolveStdioRPCTimeoutMs(request)

    expect(browserTimeoutMs).toBe(30_000)
    expect(stdioTimeoutMs).toBe(50_000)
    expect(stdioTimeoutMs).toBeGreaterThan(browserTimeoutMs)
  })

  test('gives every tool request at least 60 seconds at the browser layer', () => {
    for (const request of [
      ...['render', 'export_image', 'get_current_page'].map((name) => ({
        command: 'tool',
        args: { name, args: {} }
      })),
      {
        command: 'plugin_mcp_tool',
        args: { name: 'installed-plugin-exporter', pluginId: 'example.plugin', args: {} }
      }
    ]) {
      const browserTimeoutMs = resolveBrowserRPCTimeoutMs(request)
      const stdioTimeoutMs = resolveStdioRPCTimeoutMs(request)

      expect(browserTimeoutMs).toBe(120_000)
      expect(browserTimeoutMs).toBeGreaterThanOrEqual(60_000)
      expect(stdioTimeoutMs).toBe(140_000)
      expect(stdioTimeoutMs).toBeGreaterThan(browserTimeoutMs)
    }
  })

  test('reports the resolved deadline in seconds', () => {
    expect(rpcTimeoutMessage(resolveBrowserRPCTimeoutMs({ command: 'tool' }))).toBe(
      'RPC timeout (120s)'
    )
    expect(rpcTimeoutMessage(resolveStdioRPCTimeoutMs({ command: 'tool' }))).toBe(
      'RPC timeout (140s)'
    )
  })
})
