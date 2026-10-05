import { describe, expect, test } from 'bun:test'

import {
  PREVIEW_MESSAGE_LIMITS,
  createPreviewEditorMessage,
  parsePreviewInboundMessage,
  parsePreviewMessageEvent
} from '@/app/lowcode/preview-pane/iframe/messages'

const CHANNEL = 'preview_channel_0123456789'
const item = { nodeId: 'node-1', kind: 'horizontal-overflow' }
const inbound = {
  source: 'op-lowcode-preview',
  channel: CHANNEL,
  type: 'adaptation',
  revision: 1,
  items: [item],
  truncated: false
}
const editor = { type: 'adaptation', revision: 1, textScale: 1, diagnostics: true }

function inboundItems(items: unknown) {
  return parsePreviewInboundMessage({ ...inbound, items }, CHANNEL)
}

describe('preview adaptation protocol boundary', () => {
  test('accepts all editor scales with exact channel-bound canonical fields', () => {
    for (const textScale of [1, 1.3, 1.6, 2]) {
      for (const diagnostics of [true, false]) {
        const payload = { ...editor, textScale, diagnostics }
        expect(createPreviewEditorMessage(CHANNEL, payload)).toEqual({
          source: 'op-lowcode-editor',
          channel: CHANNEL,
          ...payload
        })
      }
    }
    expect(createPreviewEditorMessage('short', editor)).toBeNull()
  })

  test('rejects unrecognized editor scales and nonboolean diagnostic flags', () => {
    for (const textScale of [0, 1.1, 1.5, 3, Number.NaN, Infinity, '1', null, undefined]) {
      expect(createPreviewEditorMessage(CHANNEL, { ...editor, textScale })).toBeNull()
    }
    for (const diagnostics of [0, 1, 'true', null, undefined]) {
      expect(createPreviewEditorMessage(CHANNEL, { ...editor, diagnostics })).toBeNull()
    }
  })

  test('accepts only nonnegative safe integer revisions in both directions', () => {
    for (const revision of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(createPreviewEditorMessage(CHANNEL, { ...editor, revision })).not.toBeNull()
      expect(parsePreviewInboundMessage({ ...inbound, revision }, CHANNEL)).not.toBeNull()
    }
    for (const revision of [
      -1,
      0.1,
      Number.NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '1'
    ]) {
      expect(createPreviewEditorMessage(CHANNEL, { ...editor, revision })).toBeNull()
      expect(parsePreviewInboundMessage({ ...inbound, revision }, CHANNEL)).toBeNull()
    }
  })

  test('accepts every closed diagnostic kind without carrying arbitrary text or geometry', () => {
    const items = ['horizontal-overflow', 'text-clipping', 'fixed-height-risk'].map((kind) => ({
      nodeId: 'node-1',
      kind
    }))
    expect(inboundItems(items)).toEqual({ ...inbound, items })
    expect(inboundItems([{ ...item, kind: 'script' }])).toBeNull()
    for (const extra of ['text', 'message', 'value', 'rect', 'url', 'html']) {
      expect(inboundItems([{ ...item, [extra]: 'business content' }])).toBeNull()
    }
  })

  test('permits empty and truncated reports without inventing a successful full scan', () => {
    expect(inboundItems([])).toEqual({ ...inbound, items: [] })
    expect(parsePreviewInboundMessage({ ...inbound, items: [], truncated: true }, CHANNEL)).toEqual(
      { ...inbound, items: [], truncated: true }
    )
    for (const truncated of [0, 1, 'false', null, undefined]) {
      expect(parsePreviewInboundMessage({ ...inbound, truncated }, CHANNEL)).toBeNull()
    }
  })

  test('bounds item count and rejects oversized or sparse arrays before traversal', () => {
    const items = Array.from({ length: PREVIEW_MESSAGE_LIMITS.adaptationItems }, (_, index) => ({
      ...item,
      nodeId: `node-${index}`
    }))
    expect(inboundItems(items)).not.toBeNull()
    expect(inboundItems([...items, item])).toBeNull()
    const sparse: unknown[] = []
    sparse.length = 1
    expect(inboundItems(sparse)).toBeNull()
    const huge: unknown[] = []
    huge.length = 0xffff_ffff
    expect(inboundItems(huge)).toBeNull()
  })

  test('bounds node IDs and rejects C0, DEL and C1 controls', () => {
    expect(inboundItems([{ ...item, nodeId: 'n'.repeat(512) }])).not.toBeNull()
    for (const nodeId of ['', 'n'.repeat(513), 'node\n1', 'node\0', 'node\u007f', 'node\u0085']) {
      expect(inboundItems([{ ...item, nodeId }])).toBeNull()
    }
    for (const nodeId of [1, {}, null, undefined]) {
      expect(inboundItems([{ ...item, nodeId }])).toBeNull()
    }
  })

  test('rejects unknown, missing and symbol fields in envelope and editor payload', () => {
    for (const value of [
      { ...inbound, extra: true },
      { ...inbound, source: 'op-lowcode-editor' },
      { ...inbound, channel: `${CHANNEL}x` },
      { ...inbound, [Symbol('hidden')]: true }
    ]) {
      expect(parsePreviewInboundMessage(value, CHANNEL)).toBeNull()
    }
    const { truncated: _truncated, ...missing } = inbound
    expect(parsePreviewInboundMessage(missing, CHANNEL)).toBeNull()
    expect(createPreviewEditorMessage(CHANNEL, { ...editor, extra: true })).toBeNull()
    expect(
      createPreviewEditorMessage(CHANNEL, { ...editor, source: 'op-lowcode-editor' })
    ).toBeNull()
    expect(createPreviewEditorMessage(CHANNEL, { ...editor, [Symbol('hidden')]: true })).toBeNull()
    const { diagnostics: _diagnostics, ...missingEditor } = editor
    expect(createPreviewEditorMessage(CHANNEL, missingEditor)).toBeNull()
  })

  test('rejects accessors at every adaptation nesting level without invoking them', () => {
    let reads = 0
    const accessor = {
      enumerable: true,
      get() {
        reads += 1
        return 'node-1'
      }
    }
    const envelope = { ...inbound }
    Object.defineProperty(envelope, 'revision', accessor)
    expect(parsePreviewInboundMessage(envelope, CHANNEL)).toBeNull()
    const nested = { ...item }
    Object.defineProperty(nested, 'nodeId', accessor)
    expect(inboundItems([nested])).toBeNull()
    const entries: unknown[] = [item]
    Object.defineProperty(entries, '0', accessor)
    expect(inboundItems(entries)).toBeNull()
    const payload = { ...editor }
    Object.defineProperty(payload, 'textScale', accessor)
    expect(createPreviewEditorMessage(CHANNEL, payload)).toBeNull()
    expect(reads).toBe(0)
  })

  test('rejects nonenumerable properties and enriched arrays', () => {
    const hidden = { ...item }
    Object.defineProperty(hidden, 'nodeId', { value: 'node-1', enumerable: false })
    expect(inboundItems([hidden])).toBeNull()
    const entries = [item]
    Object.defineProperty(entries, 'extra', { value: true, enumerable: true })
    expect(inboundItems(entries)).toBeNull()
    const symbolic = [item]
    Object.defineProperty(symbolic, Symbol('extra'), { value: true })
    expect(inboundItems(symbolic)).toBeNull()
    expect(inboundItems([{ ...item, [Symbol('hidden')]: true }])).toBeNull()
  })

  test('rejects prototype manipulation and pollution-shaped fields', () => {
    expect(
      parsePreviewInboundMessage(
        Object.assign(Object.create({ inherited: true }), inbound),
        CHANNEL
      )
    ).toBeNull()
    expect(
      createPreviewEditorMessage(CHANNEL, Object.assign(Object.create({ inherited: true }), editor))
    ).toBeNull()
    expect(inboundItems([Object.assign(Object.create({ inherited: true }), item)])).toBeNull()
    const entries = [item]
    Object.setPrototypeOf(entries, Object.create(Array.prototype))
    expect(inboundItems(entries)).toBeNull()
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const polluted = Object.assign(Object.create(null), item)
      polluted[name] = { polluted: true }
      expect(inboundItems([polluted])).toBeNull()
    }
    expect(inboundItems([Object.assign(Object.create(null), item)])).not.toBeNull()
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
  })

  test('returns independent canonical item snapshots after validation', () => {
    const raw = { ...inbound, items: [{ ...item }] }
    const parsed = parsePreviewInboundMessage(raw, CHANNEL)
    expect(parsed?.type).toBe('adaptation')
    if (parsed?.type !== 'adaptation') throw new Error('Expected adaptation message')
    raw.items[0].nodeId = 'changed'
    raw.items.push({ ...item, nodeId: 'second' })
    expect(parsed.items).toEqual([item])
  })

  test('continues requiring exact iframe source, origin and channel correlation', () => {
    const source = {} as MessageEventSource
    expect(
      parsePreviewMessageEvent({ source, origin: 'null', data: inbound }, source, 'null', CHANNEL)
    ).toEqual(inbound)
    expect(
      parsePreviewMessageEvent(
        { source: {} as MessageEventSource, origin: 'null', data: inbound },
        source,
        'null',
        CHANNEL
      )
    ).toBeNull()
    expect(
      parsePreviewMessageEvent(
        { source, origin: 'https://attacker.example', data: inbound },
        source,
        'null',
        CHANNEL
      )
    ).toBeNull()
    expect(parsePreviewInboundMessage(inbound, `${CHANNEL}x`)).toBeNull()
  })
})
