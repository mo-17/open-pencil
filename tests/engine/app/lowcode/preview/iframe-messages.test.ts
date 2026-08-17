import { describe, expect, test } from 'bun:test'

import {
  PREVIEW_FRAME_PROTOCOL,
  PREVIEW_MESSAGE_LIMITS,
  createPreviewEditorMessage,
  parsePreviewInboundMessage,
  parsePreviewMessageEvent,
  serializePreviewFrameName
} from '@/app/lowcode/preview-pane/iframe/messages'

const CHANNEL = 'preview_channel_0123456789'

describe('preview iframe message protocol', () => {
  test('serializes an exact, origin-bound frame boot context', () => {
    expect(JSON.parse(serializePreviewFrameName(CHANNEL, 'https://editor.example'))).toEqual({
      protocol: PREVIEW_FRAME_PROTOCOL,
      channel: CHANNEL,
      parentOrigin: 'https://editor.example',
      transport: 'window'
    })
    expect(
      JSON.parse(serializePreviewFrameName(CHANNEL, 'https://editor.example', 'message-port'))
    ).toEqual({
      protocol: PREVIEW_FRAME_PROTOCOL,
      channel: CHANNEL,
      parentOrigin: 'https://editor.example',
      transport: 'message-port'
    })
    expect(JSON.parse(serializePreviewFrameName(CHANNEL, 'tauri://localhost'))).toEqual({
      protocol: PREVIEW_FRAME_PROTOCOL,
      channel: CHANNEL,
      parentOrigin: 'tauri://localhost',
      transport: 'window'
    })
    expect(() => serializePreviewFrameName('short', 'https://editor.example')).toThrow(
      'Invalid preview channel id'
    )
    expect(() => serializePreviewFrameName(CHANNEL, 'null')).toThrow(
      'Invalid preview parent origin'
    )
    expect(() => serializePreviewFrameName(CHANNEL, 'https://user:secret@example.com')).toThrow(
      'Invalid preview parent origin'
    )
  })

  test('accepts only the correlated channel and exact payload shape', () => {
    const valid = {
      source: 'op-lowcode-preview',
      channel: CHANNEL,
      type: 'navigate',
      route: '/settings'
    }
    expect(parsePreviewInboundMessage(valid, CHANNEL)).toEqual(valid)
    expect(parsePreviewInboundMessage({ ...valid, channel: `${CHANNEL}x` }, CHANNEL)).toBeNull()
    expect(parsePreviewInboundMessage({ ...valid, source: 'other' }, CHANNEL)).toBeNull()
    expect(parsePreviewInboundMessage({ ...valid, extra: true }, CHANNEL)).toBeNull()
    expect(
      parsePreviewInboundMessage({ ...valid, route: '//attacker.example' }, CHANNEL)
    ).toBeNull()
    expect(parsePreviewInboundMessage({ ...valid, route: '/bad\nroute' }, CHANNEL)).toBeNull()
  })

  test('binds inbound messages to the exact frame source and expected origin', () => {
    const source = {} as MessageEventSource
    const data = {
      source: 'op-lowcode-preview',
      channel: CHANNEL,
      type: 'select',
      id: 'node-1'
    }
    expect(
      parsePreviewMessageEvent({ source, origin: 'null', data }, source, 'null', CHANNEL)
    ).toEqual(data)
    expect(
      parsePreviewMessageEvent(
        { source: {} as MessageEventSource, origin: 'null', data },
        source,
        'null',
        CHANNEL
      )
    ).toBeNull()
    expect(
      parsePreviewMessageEvent(
        { source, origin: 'https://attacker.example', data },
        source,
        'null',
        CHANNEL
      )
    ).toBeNull()
  })

  test('accepts only exact runtime readiness and error handshakes', () => {
    const ready = { source: 'op-lowcode-preview', channel: CHANNEL, type: 'ready' }
    expect(parsePreviewInboundMessage(ready, CHANNEL)).toEqual(ready)
    expect(parsePreviewInboundMessage({ ...ready, extra: true }, CHANNEL)).toBeNull()

    const runtimeError = {
      source: 'op-lowcode-preview',
      channel: CHANNEL,
      type: 'runtimeError',
      message: 'React failed to start'
    }
    expect(parsePreviewInboundMessage(runtimeError, CHANNEL)).toEqual(runtimeError)
    expect(
      parsePreviewInboundMessage(
        { ...runtimeError, message: 'x'.repeat(PREVIEW_MESSAGE_LIMITS.runtimeErrorLength + 1) },
        CHANNEL
      )
    ).toBeNull()
  })

  test('rejects accessors and non-plain payload prototypes without invoking them', () => {
    let getterCalls = 0
    const message = {
      source: 'op-lowcode-preview',
      channel: CHANNEL,
      type: 'select'
    }
    Object.defineProperty(message, 'id', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'node-1'
      }
    })
    expect(parsePreviewInboundMessage(message, CHANNEL)).toBeNull()
    expect(getterCalls).toBe(0)

    const nestedValue: unknown[] = []
    Object.defineProperty(nestedValue, '0', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1
        return 'secret'
      }
    })
    nestedValue.length = 1
    expect(
      parsePreviewInboundMessage(
        {
          source: 'op-lowcode-preview',
          channel: CHANNEL,
          type: 'docState',
          name: 'items',
          value: nestedValue
        },
        CHANNEL
      )
    ).toBeNull()
    expect(getterCalls).toBe(0)

    const sparseValue: unknown[] = []
    sparseValue.length = 1
    Object.defineProperty(sparseValue, 'extra', { value: 'not-an-index', enumerable: true })
    expect(
      parsePreviewInboundMessage(
        {
          source: 'op-lowcode-preview',
          channel: CHANNEL,
          type: 'docState',
          name: 'items',
          value: sparseValue
        },
        CHANNEL
      )
    ).toBeNull()

    expect(
      parsePreviewInboundMessage(
        Object.assign(Object.create({ inherited: true }), {
          source: 'op-lowcode-preview',
          channel: CHANNEL,
          type: 'select',
          id: 'node-1'
        }),
        CHANNEL
      )
    ).toBeNull()
  })

  test('bounds docState and Motion diagnostics before the UI traverses them', () => {
    const docState = {
      source: 'op-lowcode-preview',
      channel: CHANNEL,
      type: 'docState',
      name: 'filters',
      value: { query: 'pencil', tags: ['design'] }
    }
    expect(parsePreviewInboundMessage(docState, CHANNEL)).toEqual(docState)
    expect(
      parsePreviewInboundMessage(
        {
          ...docState,
          value: 'x'.repeat(PREVIEW_MESSAGE_LIMITS.stateStringLength + 1)
        },
        CHANNEL
      )
    ).toBeNull()

    const motion = {
      source: 'op-lowcode-preview',
      channel: CHANNEL,
      type: 'motionDebug',
      status: 'ready',
      snapshot: { capturedAt: 1, activeAnimationCount: 0, entries: [] },
      error: undefined
    }
    expect(parsePreviewInboundMessage(motion, CHANNEL)).toEqual(motion)
    expect(
      parsePreviewInboundMessage({ ...motion, error: 'mixed status payload' }, CHANNEL)
    ).toBeNull()
    expect(
      parsePreviewInboundMessage(
        { ...motion, status: 'error', snapshot: undefined, error: undefined },
        CHANNEL
      )
    ).toBeNull()
    expect(
      parsePreviewInboundMessage(
        {
          ...motion,
          snapshot: {
            capturedAt: 1,
            activeAnimationCount: 0,
            entries: Array.from({ length: PREVIEW_MESSAGE_LIMITS.motionEntries + 1 }, () => ({}))
          }
        },
        CHANNEL
      )
    ).toBeNull()
  })

  test('creates bounded editor messages without accepting remote secrets or invalid routes', () => {
    expect(createPreviewEditorMessage(CHANNEL, { type: 'select', id: 'node-1' })).toEqual({
      source: 'op-lowcode-editor',
      channel: CHANNEL,
      type: 'select',
      id: 'node-1'
    })
    expect(
      createPreviewEditorMessage(CHANNEL, { type: 'navigate', route: 'https://attacker.example' })
    ).toBeNull()
    expect(
      createPreviewEditorMessage(CHANNEL, {
        type: 'docState',
        name: 'value',
        value: () => 'not portable'
      })
    ).toBeNull()
    expect(
      createPreviewEditorMessage(CHANNEL, {
        type: 'theme',
        theme: 'light',
        source: 'attacker',
        channel: 'attacker'
      })
    ).toBeNull()
    expect(
      createPreviewEditorMessage(CHANNEL, { type: 'motionDebug', enabled: true, extra: true })
    ).toBeNull()
    expect(createPreviewEditorMessage(CHANNEL, { type: 'theme', theme: 'system' })).toBeNull()
  })
})
