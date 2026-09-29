import { expect, test } from 'bun:test'

import {
  createTimelineModuleInstance,
  resolveTimelineModule,
  TIMELINE_DEFAULT_ITEM,
  TIMELINE_MODULE_DEFAULT_CONFIG,
  timelineColumns
} from '#core/plugins/timeline'

test('timeline validates unique bounded inert events and exact versioned fields', () => {
  const instance = createTimelineModuleInstance()
  expect(resolveTimelineModule(instance)?.ok).toBe(true)
  expect(resolveTimelineModule({ ...instance, configVersion: 2 })?.ok).toBe(false)
  const sparse: unknown[] = []
  sparse.length = 2
  for (const invalid of [
    {
      items: Array.from({ length: 25 }, (_, index) => ({
        ...TIMELINE_DEFAULT_ITEM,
        id: String(index)
      }))
    },
    { items: [{ ...TIMELINE_DEFAULT_ITEM }, { ...TIMELINE_DEFAULT_ITEM }] },
    ...['', 'bad id', '<script>', '_prototype', 'x'.repeat(65)].map((id) => ({
      items: [{ ...TIMELINE_DEFAULT_ITEM, id }]
    })),
    { items: [{ ...TIMELINE_DEFAULT_ITEM, title: '' }] },
    { items: [{ ...TIMELINE_DEFAULT_ITEM, title: 'x'.repeat(121) }] },
    { items: [{ ...TIMELINE_DEFAULT_ITEM, description: 'x'.repeat(601) }] },
    { items: [{ ...TIMELINE_DEFAULT_ITEM, time: 'x'.repeat(81) }] },
    { items: [{ ...TIMELINE_DEFAULT_ITEM, status: 'executing' }] },
    { items: [{ ...TIMELINE_DEFAULT_ITEM, execute: 'run' }] },
    { items: sparse },
    { layout: 'horizontal' },
    { emptyText: '' },
    { itemGap: 7 },
    { itemGap: 65 },
    { markerSize: 7 },
    { markerSize: 25 },
    { lineWidth: 0 },
    { lineWidth: 5 },
    { fontSize: Infinity },
    { lineColor: 'url(https://example.com)' },
    { errorColor: '#fff' }
  ])
    expect(() => createTimelineModuleInstance(invalid)).toThrow()
  expect(
    resolveTimelineModule({ ...instance, config: { ...instance.config, script: 'run' } })?.ok
  ).toBe(false)
})

test('timeline allows empty events, preserves literal text and rejects accessors without invoking them', () => {
  expect(
    resolveTimelineModule(createTimelineModuleInstance({ items: [], emptyText: '尚无记录' }))?.ok
  ).toBe(true)
  const plain = createTimelineModuleInstance({
    items: [
      { ...TIMELINE_DEFAULT_ITEM, title: '<b>纯文本</b>', description: '中文\nEnglish', time: '' }
    ]
  })
  const resolved = resolveTimelineModule(plain)
  expect(resolved?.ok && resolved.config.items[0].title).toBe('<b>纯文本</b>')
  let reads = 0
  const item = { ...TIMELINE_DEFAULT_ITEM }
  Object.defineProperty(item, 'title', {
    enumerable: true,
    get() {
      reads++
      return 'Read'
    }
  })
  expect(() => createTimelineModuleInstance({ items: [item] })).toThrow()
  expect(reads).toBe(0)
  const first = createTimelineModuleInstance(),
    second = createTimelineModuleInstance()
  const parsed = resolveTimelineModule(first)
  if (!parsed?.ok) throw new Error('Fixture failed')
  parsed.config.items[0].title = 'Changed'
  expect(second.config).toEqual(TIMELINE_MODULE_DEFAULT_CONFIG)
})

test('alternating timeline reserves readable columns and collapses compact frames to start', () => {
  expect(timelineColumns(320, 16, 'alternate')).toEqual(timelineColumns(320, 16, 'start'))
  const wide = timelineColumns(640, 16, 'alternate')
  expect(wide.alternate).toBe(true)
  expect(wide.markerX).toBe(320)
  expect(wide.endX + wide.textWidth).toBe(624)
  expect(wide.startX + wide.textWidth).toBeLessThan(wide.markerX - 8)
  expect(timelineColumns(20, 24, 'start').textWidth).toBe(0)
})
