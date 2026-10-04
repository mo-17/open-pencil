import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { buildOpenPencilTreeComponent } from '#compiler/adapters/react/modules/tree'
import { TREE_CONFIG_SOURCE, TREE_STATE_SOURCE } from '#compiler/adapters/tree/source'
import { buildOpenPencilVueTree } from '#compiler/adapters/vue/modules/tree'

import { TREE_MODULE_DEFAULT_CONFIG, type TreeRow } from '@open-pencil/core/plugins'

import type { TreeRuntimeState } from '#tests/helpers/compiler/modules/tree/model'

/** Minimal DOM ancestry used by the generated handler; it does not mutate global DOM types. */
class TreeElement {
  constructor(
    readonly attributes: Record<string, string> = {},
    readonly parent: TreeElement | null = null
  ) {}

  matches(selector: string): boolean {
    return selector
      .split(',')
      .some((part) => part.startsWith('[') && part.slice(1, -1) in this.attributes)
  }

  closest(selector: string): TreeElement | null {
    if (this.matches(selector)) return this
    return this.parent?.closest(selector) ?? null
  }

  contains(target: TreeElement): boolean {
    for (let element: TreeElement | null = target; element; element = element.parent)
      if (element === this) return true
    return false
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }
}

const shared = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  TREE_CONFIG_SOURCE + TREE_STATE_SOURCE
)
const runtime = runInNewContext(shared + '\n({visibleRows,activeTreeId})') as {
  visibleRows(config: typeof TREE_MODULE_DEFAULT_CONFIG, state: TreeRuntimeState): TreeRow[]
  activeTreeId(rows: TreeRow[], state: TreeRuntimeState): string
}

function handler(target: 'react' | 'vue', overrides: Partial<TreeRuntimeState> = {}) {
  const config = {
    ...structuredClone(TREE_MODULE_DEFAULT_CONFIG),
    items: [
      ...structuredClone(TREE_MODULE_DEFAULT_CONFIG.items),
      { id: 'archived-child', label: 'Archived child', parentId: 'archive', disabled: false }
    ]
  }
  const state: TreeRuntimeState = {
    selected: ['development'],
    expanded: ['project', 'archive'],
    query: '',
    activeId: 'development',
    open: false,
    ...overrides
  }
  const rows = runtime.visibleRows(config, state),
    active = runtime.activeTreeId(rows, state)
  const changes: TreeRuntimeState[] = [],
    updates: TreeRuntimeState[] = []
  const source = target === 'react' ? buildOpenPencilTreeComponent() : buildOpenPencilVueTree()
  const onKeySource = source
    .split('\n')
    .find((line) => line.trimStart().startsWith('function onKey('))
  if (!onKeySource) throw new Error('Missing generated Tree keyboard handler')
  const vue = target === 'vue'
  const onKey = runInNewContext(
    shared + '\n' + new Bun.Transpiler({ loader: 'ts' }).transformSync(onKeySource) + '\nonKey',
    {
      Element: TreeElement,
      config: vue ? { value: config } : config,
      props: { config },
      state: vue ? { value: state } : state,
      view: vue ? { value: state } : state,
      rows: vue ? { value: rows } : rows,
      active: vue ? { value: active } : active,
      inactive: vue ? { value: false } : false,
      readonly: vue ? { value: false } : false,
      applySelection: (next: TreeRuntimeState) => changes.push(next),
      update: (next: TreeRuntimeState) => updates.push(next)
    }
  ) as (event: {
    target: TreeElement | null
    currentTarget: TreeElement
    key: string
    preventDefault(): void
  }) => void
  const list = new TreeElement({ 'data-tree-list': '' })
  function row(id: string, parent = list): TreeElement {
    return new TreeElement({ 'data-tree-row': '', 'data-tree-id': id }, parent)
  }
  function press(source: TreeElement | null, key: string): boolean {
    let prevented = false
    onKey({
      target: source,
      currentTarget: list,
      key,
      preventDefault() {
        prevented = true
      }
    })
    return prevented
  }
  return { state, changes, updates, list, row, press }
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} force-focused disabled rows cannot activate the selected Development fallback`, () => {
    // A poisoned activeId also models the old unguarded disabled-row focus update.
    const model = handler(target, { activeId: 'archive' })
    for (const id of ['archive', 'archived-child'])
      for (const key of ['Enter', ' ']) model.press(model.row(id), key)
    expect(model.changes).toEqual([])
    expect(model.updates).toEqual([])
    expect(model.state.selected).toEqual(['development'])
  })

  test(`${target} keyboard source rejects missing, collapsed, hidden and foreign tree rows`, () => {
    const model = handler(target, { expanded: ['archive'] })
    const hidden = new TreeElement({ hidden: '' }, model.list)
    const inert = new TreeElement({ inert: '' }, model.list)
    const nestedList = new TreeElement({ 'data-tree-list': '' }, model.list)
    const foreignList = new TreeElement({ 'data-tree-list': '' })
    for (const source of [
      null,
      model.row('missing'),
      model.row('development'),
      model.row('project', hidden),
      model.row('project', inert),
      model.row('project', nestedList),
      model.row('project', foreignList),
      new TreeElement({}, model.list)
    ])
      for (const key of ['Enter', ' ']) model.press(source, key)
    expect(model.changes).toEqual([])
    expect(model.updates).toEqual([])
    expect(model.state.selected).toEqual(['development'])
  })

  test(`${target} enabled row keyboard uses its actual source despite stale active selection`, () => {
    const model = handler(target)
    model.press(new TreeElement({}, model.row('design')), 'Enter')
    expect(model.changes).toHaveLength(1)
    expect(model.changes[0].selected).toEqual(['design'])
    expect(model.updates).toEqual([])
  })

  test(`${target} list itself retains active-row keyboard navigation`, () => {
    const model = handler(target)
    model.press(model.list, 'Enter')
    expect(model.changes).toEqual([])
    expect(model.updates[0].selected).toEqual(['development'])
    expect(model.press(model.list, 'Home')).toBe(true)
    expect(model.updates[1].activeId).toBe('project')
    expect(model.updates[1].selected).toEqual(['development'])
  })
}
