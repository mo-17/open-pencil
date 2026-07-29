import { describe, expect, test } from 'bun:test'

import { isDeadSocketConnectError } from '#mcp/transport/socket-liveness'

function socketError(code?: string): Error {
  return Object.assign(new Error(code ?? 'unknown socket error'), code ? { code } : {})
}

describe('Unix socket liveness errors', () => {
  test('treats refused and orphaned-path errors as dead listeners', () => {
    expect(isDeadSocketConnectError(socketError('ECONNREFUSED'))).toBe(true)
    expect(isDeadSocketConnectError(socketError('ENOENT'))).toBe(true)
  })

  test('keeps permission, timeout, and unknown errors conservative', () => {
    expect(isDeadSocketConnectError(socketError('EACCES'))).toBe(false)
    expect(isDeadSocketConnectError(socketError('EPERM'))).toBe(false)
    expect(isDeadSocketConnectError(socketError('ETIMEDOUT'))).toBe(false)
    expect(isDeadSocketConnectError(socketError())).toBe(false)
    expect(isDeadSocketConnectError('ENOENT')).toBe(false)
  })
})
