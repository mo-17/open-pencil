import { describe, expect, test } from 'bun:test'

import { tauriResponseBody, withAbortSignal } from '@/app/tauri/http'

describe('withAbortSignal', () => {
  test('uses a null body for Fetch null-body statuses', () => {
    expect(tauriResponseBody(204, [])).toBeNull()
    expect(tauriResponseBody(205, [1])).toBeNull()
    expect(tauriResponseBody(304, [])).toBeNull()
    expect(tauriResponseBody(200, [1, 2])).toEqual(new Uint8Array([1, 2]))
  })

  test('resolves with the wrapped promise', async () => {
    const controller = new AbortController()

    await expect(withAbortSignal(Promise.resolve('ok'), controller.signal)).resolves.toBe('ok')
  })

  test('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)

    const pending = Promise.withResolvers<string>()
    const result = withAbortSignal(pending.promise, controller.signal)

    await expect(result).rejects.toBe(reason)
    pending.reject(new Error('late request failure'))
    await Promise.resolve()
  })

  test('rejects a pending promise when the signal aborts', async () => {
    const controller = new AbortController()
    const pending = Promise.withResolvers<string>()
    const result = withAbortSignal(pending.promise, controller.signal)
    const reason = new Error('cancelled')

    let nativeCompleted = false
    void pending.promise.then(() => {
      nativeCompleted = true
      return undefined
    })
    controller.abort(reason)

    await expect(result).rejects.toBe(reason)
    expect(nativeCompleted).toBe(false)
    pending.resolve('late result')
    await pending.promise
    await Promise.resolve()
    expect(nativeCompleted).toBe(true)
  })

  test('documents the Tauri dispatch marker immediately before native invoke', async () => {
    const source = await Bun.file('src/app/tauri/http.ts').text()
    const dispatchIndex = source.indexOf('onDispatch?.()')
    const invokeIndex = source.indexOf("invoke<ProxyHttpResponse>('proxy_http_request'")
    expect(dispatchIndex).toBeGreaterThan(-1)
    expect(invokeIndex).toBeGreaterThan(dispatchIndex)
  })

  test('forwards separate success/error response limits and a native timeout', async () => {
    const source = await Bun.file('src/app/tauri/http.ts').text()
    expect(source).toContain('max_response_bytes: maxResponseBytes')
    expect(source).toContain('max_error_response_bytes: maxErrorResponseBytes')
    expect(source).toContain('timeout_ms: timeoutMs')
  })
})
