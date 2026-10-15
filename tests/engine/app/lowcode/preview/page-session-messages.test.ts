import { expect, test } from 'bun:test'

import {
  createPreviewEditorMessage,
  parsePreviewInboundMessage,
  parsePreviewMessageEvent,
  parsePreviewPageSessionSnapshot,
  type PreviewPageSessionSnapshot
} from '@/app/lowcode/preview-pane/iframe/messages'

const CHANNEL = 'page_session_channel_0123456789'
function snapshot(): PreviewPageSessionSnapshot {
  return {
    version: 1,
    entries: [
      {
        pageId: 'page-1',
        pathname: '/items/42',
        search: '?tab=edit',
        values: { draft: '初始', count: 1 },
        scroll: { x: 0, y: 420 }
      }
    ]
  }
}

test('page-session messages remain source, origin, channel and exact-shape bound', () => {
  const data = {
    source: 'op-lowcode-preview',
    channel: CHANNEL,
    type: 'pageSession',
    snapshot: snapshot()
  }
  const source = {} as MessageEventSource
  expect<unknown>(parsePreviewInboundMessage(data, CHANNEL)).toEqual(data)
  expect<unknown>(
    createPreviewEditorMessage(CHANNEL, { type: 'pageSession', snapshot: data.snapshot })
  ).toEqual({ ...data, source: 'op-lowcode-editor' })
  expect(parsePreviewInboundMessage({ ...data, extra: true }, CHANNEL)).toBeNull()
  expect(parsePreviewInboundMessage({ ...data, channel: 'wrong' }, CHANNEL)).toBeNull()
  expect<unknown>(
    parsePreviewMessageEvent({ source, origin: 'null', data }, source, 'null', CHANNEL)
  ).toEqual(data)
  expect(
    parsePreviewMessageEvent(
      { source, origin: 'https://outside.example', data },
      source,
      'null',
      CHANNEL
    )
  ).toBeNull()
})

test('snapshot validation rejects unsafe paths, duplicate locations, invalid coordinates and unknown fields', () => {
  const original = snapshot()
  const invalid = [
    { ...original, version: 2 },
    { ...original, extra: true },
    { ...original, entries: [original.entries[0], original.entries[0]] },
    { ...original, entries: [{ ...original.entries[0], pathname: '//outside.example' }] },
    { ...original, entries: [{ ...original.entries[0], pathname: '/items?tab=x' }] },
    { ...original, entries: [{ ...original.entries[0], search: '#unsafe' }] },
    { ...original, entries: [{ ...original.entries[0], scroll: { x: 0, y: -1 } }] },
    { ...original, entries: [{ ...original.entries[0], scroll: { x: 0, y: Infinity } }] }
  ]
  for (const value of invalid) expect(parsePreviewPageSessionSnapshot(value)).toBeNull()
})

test('nested getters, symbols, sparse arrays, classes and cycles are rejected without invoking accessors', () => {
  let reads = 0
  const accessor = Object.defineProperty({}, 'draft', {
    enumerable: true,
    get() {
      reads++
      return 'do not read'
    }
  })
  const sparse: unknown[] = []
  sparse.length = 1
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  for (const values of [
    accessor,
    { [Symbol('key')]: 1 },
    { sparse },
    { date: new Date() },
    { cycle }
  ]) {
    const value = snapshot()
    value.entries[0].values = values
    expect(parsePreviewPageSessionSnapshot(value)).toBeNull()
  }
  expect(reads).toBe(0)
})

test('count and portable message budgets apply to the complete snapshot, and accepted data is detached', () => {
  const value = snapshot()
  expect(
    parsePreviewPageSessionSnapshot({
      version: 1,
      entries: Array.from({ length: 65 }, (_, index) => ({
        ...value.entries[0],
        search: `?id=${index}`
      }))
    })
  ).toBeNull()
  value.entries[0].values = { first: '中'.repeat(65536), second: '中'.repeat(65536) }
  expect(parsePreviewPageSessionSnapshot(value)).toBeNull()
  const original = snapshot()
  const parsed = parsePreviewPageSessionSnapshot(original)
  original.entries[0].values.count = 99
  expect(parsed?.entries[0].values.count).toBe(1)
})

test('complete UTF-8 budget rejects Chinese data that fits the UTF-16 estimate', () => {
  const value = snapshot()
  value.entries[0].values = Object.fromEntries(
    ['first', 'second', 'third'].map((name) => [name, '中'.repeat(43000)])
  )
  expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeGreaterThan(256 * 1024)
  expect(parsePreviewPageSessionSnapshot(value)).toBeNull()
  value.entries[0].values.third = '中'.repeat(500)
  expect(parsePreviewPageSessionSnapshot(value)).not.toBeNull()
})
