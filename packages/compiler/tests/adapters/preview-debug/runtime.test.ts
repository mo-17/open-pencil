import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { buildPreviewDebugRuntime } from '#compiler/adapters/preview-debug/runtime'

interface DebugEntry {
  sequence: number
  trace: number
  nodeId: string | null
  kind: string
  label: string
  status: string
  durationMs: number | null
}
interface DebugMessage {
  type: string
  entries: DebugEntry[]
  dropped: number
}
interface DebugAPI {
  begin(nodeId: string, label: string): number
  step(
    trace: number,
    kind: 'action' | 'state',
    label: string,
    status: 'start' | 'success' | 'error' | 'changed'
  ): void
  expression<T>(trace: number, compute: () => T): T
}

function fixture(status = 503) {
  const messages: DebugMessage[] = []
  const frames = new Map<number, FrameRequestCallback>()
  let frame = 0
  const nativeFetch: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> = async () =>
    new Response('private body', { status })
  const window = Object.assign(new EventTarget(), {
    fetch: nativeFetch,
    __opLowcodeDebug: undefined as DebugAPI | undefined
  })
  const document = new EventTarget()
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(buildPreviewDebugRuntime())
  const controls: { setEnabled: (enabled: boolean) => void; state: (name: string) => void } =
    runInNewContext(
      `${javascript}; ({ setEnabled: setRuntimeDebugEnabled, state: runtimeDebugState })`,
      {
        window,
        document,
        postToParent: (message: DebugMessage) => messages.push(message),
        MAX_NODE_ID_LENGTH: 512,
        performance,
        queueMicrotask,
        Request,
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          const id = ++frame
          frames.set(id, callback)
          return id
        },
        cancelAnimationFrame: (id: number) => frames.delete(id)
      }
    )
  function flush() {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(performance.now())
  }
  function api() {
    const value = window.__opLowcodeDebug
    if (!value) throw new Error('Debug host was not installed')
    return value
  }
  return { window, nativeFetch, messages, frames, controls, flush, api }
}

describe('dev preview debug runtime', () => {
  test('records successful requests as method, status and duration only', async () => {
    const state = fixture(200)
    state.controls.setEnabled(true)
    const trace = state.api().begin('button', 'onClick')
    await state.window.fetch('https://example.invalid/private')
    state.flush()
    const response = state.messages
      .flatMap((message) => message.entries)
      .find((entry) => entry.kind === 'request' && entry.status === 'success')
    expect(response).toMatchObject({ trace, nodeId: 'button', label: 'GET 200' })
    expect(response?.durationMs).toBeGreaterThanOrEqual(0)
    state.controls.setEnabled(false)
  })
  test('stays idle until enabled and never collects request or state values', async () => {
    const state = fixture()
    expect(state.api().begin('button', 'onClick')).toBe(0)
    expect(state.window.fetch).toBe(state.nativeFetch)
    state.controls.setEnabled(true)
    const trace = state.api().begin('button', 'onClick')
    state.api().expression(trace, () => 'private field value')
    state.controls.state('result')
    await state.window.fetch('https://example.invalid/token=private', {
      method: 'POST',
      body: 'private payload',
      headers: { Authorization: 'private bearer' }
    })
    state.flush()
    const entries = state.messages.flatMap((message) => message.entries)
    expect(
      entries.some(
        (entry) =>
          entry.kind === 'request' && entry.label === 'POST 503' && entry.status === 'error'
      )
    ).toBe(true)
    expect(
      entries.filter((entry) => entry.kind === 'request').every((entry) => entry.trace === trace)
    ).toBe(true)
    expect(entries.some((entry) => entry.kind === 'state' && entry.label === 'result')).toBe(true)
    expect(JSON.stringify(entries)).not.toContain('private')
    state.controls.setEnabled(false)
    expect(state.window.fetch).toBe(state.nativeFetch)
    expect(state.frames.size).toBe(0)
  })

  test('bounds pending work and rejects completions from a cleared recording', async () => {
    const state = fixture()
    state.controls.setEnabled(true)
    const trace = state.api().begin('button', 'onClick')
    for (let i = 0; i < 100; i++) state.api().step(trace, 'action', 'setState', 'start')
    expect(state.frames.size).toBe(1)
    state.flush()
    expect(state.messages.at(-1)?.entries).toHaveLength(32)
    expect(state.messages.at(-1)?.dropped).toBe(69)
    state.controls.setEnabled(true)
    state.api().step(trace, 'action', 'setState', 'success')
    state.flush()
    expect(state.messages.at(-1)?.entries).toEqual([])
    expect(state.api().expression(0, () => null)).toBeNull()
    state.window.dispatchEvent(new Event('pagehide'))
    expect(state.window.__opLowcodeDebug).toBeUndefined()
    expect(state.window.fetch).toBe(state.nativeFetch)
  })
})
