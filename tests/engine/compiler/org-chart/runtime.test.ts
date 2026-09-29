import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { ORG_CHART_MATH_SOURCE } from '#compiler/adapters/org-chart/math'
import {
  ORG_CHART_CONFIG_SOURCE,
  ORG_CHART_STATE_SOURCE
} from '#compiler/adapters/org-chart/source'

import {
  ORG_CHART_MODULE_DEFAULT_CONFIG,
  orgChartLayout,
  type OrgChartModuleConfigV1,
  type OrgChartCard,
  type OrgChartItem
} from '@open-pencil/core/plugins'

interface State {
  collapsed: string[]
  activeId: string
}
interface Runtime {
  orgChartLayout: typeof orgChartLayout
  initialOrgChart(config: OrgChartModuleConfigV1): State
  orgChartKey(config: OrgChartModuleConfigV1): string
  orgChartActive(cards: readonly OrgChartCard[], id: string, items: readonly OrgChartItem[]): string
  orgChartToggle(config: OrgChartModuleConfigV1, state: State, id: string): State
  orgChartKeyboard(
    config: OrgChartModuleConfigV1,
    state: State,
    cards: readonly OrgChartCard[],
    key: string
  ): { state: State; handled: boolean }
}
const source = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(
  ORG_CHART_CONFIG_SOURCE + '\n' + ORG_CHART_MATH_SOURCE + '\n' + ORG_CHART_STATE_SOURCE
)
const runtime = runInNewContext(
  source +
    '\n({orgChartLayout,initialOrgChart,orgChartKey,orgChartActive,orgChartToggle,orgChartKeyboard})'
) as Runtime
const items: OrgChartItem[] = [
  { id: 'root', parentId: '', label: 'Head office', description: 'Leadership' },
  { id: 'design', parentId: 'root', label: '设计团队', description: 'Design' },
  { id: 'designer', parentId: 'design', label: 'Designer', description: '' },
  { id: 'engineering', parentId: 'root', label: 'Engineering', description: '' },
  { id: 'other', parentId: '', label: 'Independent', description: '' }
]
const config = { ...ORG_CHART_MODULE_DEFAULT_CONFIG, items }
test('generated geometry matches Canvas for bounded trees, depths, font sizes and collapse sets', () => {
  const deep = Array.from({ length: 8 }, (_, index) => ({
    id: 'n' + index,
    parentId: index ? 'n' + (index - 1) : '',
    label: 'Level ' + index,
    description: ''
  }))
  const wide = Array.from({ length: 64 }, (_, index) => ({
    id: 'n' + index,
    parentId: index ? 'n0' : '',
    label: 'Node ' + index,
    description: 'Details'
  }))
  for (const data of [items, deep, wide])
    for (const direction of ['horizontal', 'vertical'] as const)
      for (const width of [0, 120, 180, 320, 375, 640, 1200])
        for (const fontSize of [10, 14, 24])
          for (const collapsed of [[], ['root'], ['design'], ['n0'], ['n1', 'n5']]) {
            const value = { ...config, items: data, direction, fontSize }
            expect(runtime.orgChartLayout(width, value, collapsed)).toEqual(
              orgChartLayout(width, value, collapsed)
            )
          }
})
test('folding never mutates authored config, while initial state and instances remain independent', () => {
  const initial = runtime.initialOrgChart(config),
    other = runtime.initialOrgChart(config),
    before = JSON.stringify(config)
  const folded = runtime.orgChartToggle(config, initial, 'design')
  expect(folded.collapsed).toEqual(['design'])
  expect(other.collapsed).toEqual([])
  expect(JSON.stringify(config)).toBe(before)
  const cards = runtime.orgChartLayout(320, config, folded.collapsed).cards
  expect(cards.map((card) => card.id)).toEqual(['root', 'design', 'engineering', 'other'])
  expect(runtime.orgChartActive(cards, 'designer', items)).toBe('design')
  expect(runtime.orgChartToggle(config, folded, 'designer')).toBe(folded)
  const fixed = { ...config, collapsible: false, initialCollapsedIds: ['root'] }
  expect(runtime.initialOrgChart(fixed).collapsed).toEqual([])
  expect(runtime.orgChartLayout(320, fixed).cards.length).toBe(5)
  expect(runtime.orgChartToggle(fixed, initial, 'root')).toBe(initial)
})
test('keyboard follows tree semantics and repairs active descendants after reset', () => {
  let state: State = { collapsed: [], activeId: 'root' }
  function press(key: string) {
    state = runtime.orgChartKeyboard(
      config,
      state,
      runtime.orgChartLayout(640, config, state.collapsed).cards,
      key
    ).state
  }
  press('ArrowRight')
  expect(state.activeId).toBe('design')
  press('ArrowRight')
  expect(state.activeId).toBe('designer')
  press('ArrowLeft')
  expect(state.activeId).toBe('design')
  press('ArrowLeft')
  expect(state.collapsed).toEqual(['design'])
  press('ArrowDown')
  expect(state.activeId).toBe('engineering')
  press('End')
  expect(state.activeId).toBe('other')
  press('Home')
  expect(state.activeId).toBe('root')
  press(' ')
  expect(state.collapsed).toEqual(['design', 'root'])
  press('Enter')
  expect(state.collapsed).toEqual(['design'])
  const rows = runtime.orgChartLayout(640, config, ['root']).cards
  expect(runtime.orgChartActive(rows, 'designer', items)).toBe('root')
  expect(runtime.orgChartKeyboard(config, state, rows, 'Tab').handled).toBe(false)
  expect(runtime.orgChartKey({ ...config, cardColor: '#ffffff' })).not.toBe(
    runtime.orgChartKey({ ...config, cardColor: '#000000' })
  )
})
