import { expect, test } from 'bun:test'

import { BUILTIN_MODULE_CANVAS_ADAPTERS } from '#core/canvas/modules/registry'
import { BUILTIN_PLUGIN_REGISTRY } from '#core/plugins/builtin'
import {
  createOrgChartModuleInstance,
  createOrgChartModuleFrameOverrides,
  resolveOrgChartModule,
  parseOrgChartItems,
  orgChartLayout,
  ORG_CHART_MODULE_DEFAULT_CONFIG,
  ORG_CHART_PLUGIN_ID,
  ORG_CHART_MODULE_TYPE,
  type OrgChartItem
} from '#core/plugins/org-chart'

const item = (id: string, parentId = ''): OrgChartItem => ({
  id,
  parentId,
  label: id,
  description: ''
})
const defaults = () => structuredClone(ORG_CHART_MODULE_DEFAULT_CONFIG)

test('Org Chart registers an exact ordinary FRAME contract and round-trips independent config', () => {
  const module = createOrgChartModuleInstance(),
    frame = createOrgChartModuleFrameOverrides()
  expect(frame.interactiveProps?.module).toEqual(module)
  expect(frame.width).toBe(640)
  expect(frame.height).toBe(400)
  expect(Object.isFrozen(ORG_CHART_MODULE_DEFAULT_CONFIG.items)).toBe(true)
  expect(Object.isFrozen(ORG_CHART_MODULE_DEFAULT_CONFIG.items[0])).toBe(true)
  const serialized = JSON.stringify(module)
  expect(resolveOrgChartModule(JSON.parse(serialized))?.ok).toBe(true)
  expect(
    BUILTIN_PLUGIN_REGISTRY.getModule(ORG_CHART_PLUGIN_ID, ORG_CHART_MODULE_TYPE)
  ).toBeDefined()
  expect(
    BUILTIN_MODULE_CANVAS_ADAPTERS.get(ORG_CHART_PLUGIN_ID, ORG_CHART_MODULE_TYPE)
  ).toBeDefined()
  expect(resolveOrgChartModule({ ...module, configVersion: 2 })?.ok).toBe(false)
  expect(resolveOrgChartModule({ ...module, pluginId: 'foreign.org-chart' })).toBeNull()
  const config = defaults()
  const authored = createOrgChartModuleInstance(config)
  config.items[0].label = 'changed'
  expect(authored.config.items).not.toEqual(config.items)
  expect(() => createOrgChartModuleInstance({ unknown: true })).toThrow()
})

test('Org Chart rejects duplicate, orphaned, cyclic, overly deep and oversized hierarchies', () => {
  for (const items of [
    [],
    [item('same'), item('same')],
    [item('child', 'missing')],
    [item('self', 'self')],
    [item('a', 'b'), item('b', 'a')],
    Array.from({ length: 9 }, (_, i) => item('n' + i, i ? 'n' + (i - 1) : '')),
    Array.from({ length: 65 }, (_, i) => item('n' + i)),
    [{ ...item('root'), label: '  ' }],
    [{ ...item('root'), children: [] }],
    [{ ...item('root'), description: 'x'.repeat(241) }]
  ])
    expect(() => parseOrgChartItems(items)).toThrow()
  expect(parseOrgChartItems(Array.from({ length: 64 }, (_, i) => item('n' + i)))).toHaveLength(64)
  expect(
    parseOrgChartItems(Array.from({ length: 8 }, (_, i) => item('n' + i, i ? 'n' + (i - 1) : '')))
  ).toHaveLength(8)
  expect(() =>
    createOrgChartModuleInstance({
      items: Array.from({ length: 64 }, (_, i) => ({
        ...item('n' + i),
        label: '中'.repeat(120),
        description: '文'.repeat(240)
      }))
    })
  ).toThrow()
})

test('Org Chart rejects sparse or accessor data without executing getters', () => {
  let calls = 0
  const unsafe = item('root')
  Object.defineProperty(unsafe, 'label', {
    enumerable: true,
    get() {
      calls++
      return 'unsafe'
    }
  })
  expect(() => parseOrgChartItems([unsafe])).toThrow()
  expect(() => createOrgChartModuleInstance({ items: [unsafe] })).toThrow()
  const sparse: unknown[] = []
  sparse.length = 2
  expect(() => parseOrgChartItems(sparse)).toThrow()
  expect(() => createOrgChartModuleInstance({ initialCollapsedIds: sparse })).toThrow()
  const indexed: unknown[] = []
  Object.defineProperty(indexed, '0', {
    enumerable: true,
    get() {
      calls++
      return item('a')
    }
  })
  expect(() => parseOrgChartItems(indexed)).toThrow()
  const extra = [item('a')]
  Object.defineProperty(extra, 'custom', {
    enumerable: true,
    get() {
      calls++
      return 1
    }
  })
  expect(() => parseOrgChartItems(extra)).toThrow()
  const top = defaults()
  Object.defineProperty(top, 'label', {
    enumerable: true,
    get() {
      calls++
      return 'unsafe'
    }
  })
  expect(() => createOrgChartModuleInstance(top)).toThrow()
  expect(calls).toBe(0)
})

test('Org Chart collapse hides only descendants, preserves sibling order and never changes authored data', () => {
  for (const ids of [['missing'], ['designer'], ['root', 'root']])
    expect(() => createOrgChartModuleInstance({ initialCollapsedIds: ids })).toThrow()
  const config = defaults(),
    before = structuredClone(config)
  const collapsed = orgChartLayout(640, config, ['design'])
  expect(collapsed.cards.map((card) => card.id)).toEqual([
    'root',
    'design',
    'engineering',
    'developer'
  ])
  expect(collapsed.connectors.map((line) => line.toId)).not.toContain('designer')
  expect(collapsed.cards.find((card) => card.id === 'design')?.collapsed).toBe(true)
  expect(orgChartLayout(640, config, ['root']).cards).toHaveLength(1)
  expect(orgChartLayout(640, { ...config, collapsible: false }, ['root']).cards).toHaveLength(5)
  expect(config).toEqual(before)
})

test('Org Chart lays out disconnected roots and orthogonal edges without overlapping cards', () => {
  for (const direction of ['vertical', 'horizontal'] as const) {
    const config = {
      ...defaults(),
      direction,
      items: [item('a'), item('a1', 'a'), item('a2', 'a'), item('b'), item('b1', 'b')]
    }
    const layout = orgChartLayout(1200, config)
    expect(layout.mode).toBe('tree')
    expect(layout.connectors).toHaveLength(3)
    expect(layout.connectors.some((line) => line.fromId === 'a' && line.toId === 'b')).toBe(false)
    for (const line of layout.connectors)
      for (let i = 1; i < line.points.length; i++) {
        const first = line.points[i - 1],
          second = line.points[i]
        expect(first.x === second.x || first.y === second.y).toBe(true)
      }
    for (const [i, card] of layout.cards.entries())
      for (const other of layout.cards.slice(i + 1))
        expect(
          card.x + card.width <= other.x ||
            other.x + other.width <= card.x ||
            card.y + card.height <= other.y ||
            other.y + other.height <= card.y
        ).toBe(true)
  }
})

test('Org Chart compact layout keeps all levels readable in 320 pixels without shrinking fonts', () => {
  const config = defaults()
  expect(orgChartLayout(640, config).height).toBeLessThanOrEqual(400)
  for (const direction of ['vertical', 'horizontal'] as const)
    for (const fontSize of [10, 14, 24]) {
      const graph = {
        ...config,
        direction,
        fontSize,
        items: [
          ...Array.from({ length: 8 }, (_, i) => item('n' + i, i ? 'n' + (i - 1) : '')),
          item('sibling', 'n0')
        ]
      }
      const layout = orgChartLayout(320, graph)
      expect(layout.mode).toBe('compact')
      expect(layout.width).toBe(320)
      for (const card of layout.cards) {
        expect(card.width).toBeGreaterThanOrEqual(160)
        expect(card.x + card.width).toBeLessThanOrEqual(320)
        expect(card.y + card.height).toBeLessThanOrEqual(layout.height)
      }
      expect(graph.fontSize).toBe(fontSize)
    }
  for (const width of [0, 1, 180, Number.NaN, Infinity]) {
    const result = orgChartLayout(width, config)
    expect(Number.isFinite(result.width)).toBe(true)
    expect(Number.isFinite(result.height)).toBe(true)
    expect(result.cards.every((card) => card.width >= 160 && card.x >= 0 && card.y >= 0)).toBe(true)
  }
})
