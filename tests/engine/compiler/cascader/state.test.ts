import { expect, test } from 'bun:test'

import { CASCADER_CONFIG_SOURCE, CASCADER_STATE_SOURCE } from '#compiler/adapters/cascader/source'

import { CASCADER_MODULE_DEFAULT_CONFIG, parseCascaderPath } from '#core/plugins/cascader'

interface State {
  open: boolean
  query: string
  branch: string[]
  activeId: string
}
interface Row {
  item: { id: string }
  path: string[]
  disabled: boolean
  branch: boolean
}
interface Runtime {
  path(config: unknown, value: unknown): string[] | null
  initial(path: string[]): State
  columns(config: unknown, state: State): Row[][]
  navigate(config: unknown, state: State, id: string): State
  keyboard(
    config: unknown,
    state: State,
    key: string
  ): { state: State; focus: string; choose: string; handled: boolean }
}
const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  CASCADER_CONFIG_SOURCE + CASCADER_STATE_SOURCE
)
const runtime = new Function(
  source +
    '\nreturn {path:cascaderPath,initial:cascaderInitial,columns:cascaderColumns,navigate:cascaderNavigate,keyboard:cascaderKeyboard}'
)() as Runtime

test('Cascader generated path projection matches Core including malformed values and cannot repair state', () => {
  const config = structuredClone(CASCADER_MODULE_DEFAULT_CONFIG)
  const sparse: unknown[] = []
  sparse.length = 2
  const values = [
    [],
    ['asia', 'china', 'xiamen'],
    ['europe', 'france'],
    ['china', 'xiamen'],
    ['asia'],
    ['asia', 'china', 'missing'],
    'xiamen',
    null,
    undefined,
    sparse
  ]
  for (const value of values)
    expect(runtime.path(config, value)).toEqual(parseCascaderPath(config.items, value))
  const china = config.items.find((item) => item.id === 'china')
  if (!china) throw new Error('Expected China fixture')
  china.disabled = true
  expect(runtime.path(config, ['asia', 'china', 'xiamen'])).toBeNull()
  expect(config.initialPath).toEqual([])
})
test('Cascader branch navigation never selects a business value; keyboard follows levels and skips disabled rows', () => {
  const config = structuredClone(CASCADER_MODULE_DEFAULT_CONFIG),
    before = structuredClone(config)
  let state = { ...runtime.initial([]), open: true, activeId: 'asia' }
  expect(runtime.columns(config, state).map((rows) => rows.map((row) => row.item.id))).toEqual([
    ['asia', 'europe']
  ])
  const first = runtime.keyboard(config, state, 'ArrowRight')
  expect(first.choose).toBe('')
  expect(first.focus).toBe('china')
  state = first.state
  const second = runtime.keyboard(config, state, 'ArrowRight')
  expect(second.choose).toBe('')
  expect(second.focus).toBe('xiamen')
  expect(runtime.keyboard(config, second.state, 'ArrowDown').focus).toBe('shanghai')
  expect(runtime.keyboard(config, second.state, 'End').focus).toBe('shanghai')
  expect(runtime.keyboard(config, second.state, 'Enter').choose).toBe('xiamen')
  const back = runtime.keyboard(config, second.state, 'ArrowLeft')
  expect(back.focus).toBe('china')
  expect(runtime.columns(config, back.state)).toHaveLength(2)
  expect(config).toEqual(before)
})
test('Cascader search matches the complete path, excludes non-leaves and carries disabled ancestry', () => {
  const config = structuredClone(CASCADER_MODULE_DEFAULT_CONFIG)
  const state = { ...runtime.initial([]), open: true, query: 'asia / china' }
  expect(runtime.columns(config, state)[0].map((row) => row.item.id)).toEqual([
    'xiamen',
    'shanghai'
  ])
  config.items[0].disabled = true
  expect(runtime.columns(config, state)[0].every((row) => row.disabled)).toBe(true)
  expect(runtime.keyboard(config, state, 'Enter').handled).toBe(false)
  expect(runtime.columns(config, { ...state, query: 'no such path' })).toEqual([[]])
})
