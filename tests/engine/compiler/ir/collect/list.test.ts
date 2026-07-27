import { beforeAll, describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement, IRList } from '#compiler/ir/types'

import { SceneGraph, initCodec } from '@open-pencil/core'

/**
 * Phase 2 §9 — LIST resolution. `collectListDirective` reads
 * `interactiveProps.dataSourceRef` + itemName / indexName, validates the
 * referenced state is array-typed, and packages the LIST's first visible
 * child as an `IRList { arrayName, itemName, indexName, template }` placed
 * as the sole child of the LIST's outer `<div>` IRElement. Datasource /
 * template failures degrade to the authored static children with a warning.
 * A LIST without a datasource is a plain visual container, so all of its
 * authored children are preserved.
 */
describe('collectTree — LIST directive (Phase 2 §9)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function makeListGraph(opts: {
    arrayState?: 'array' | 'number'
    dataSourceRef?: { kind?: string; stateId?: string } | null
    itemName?: string
    indexName?: string
    visibleChildren?: number
    childTextBinding?: { kind: 'expr' | 'literal'; expr?: string; literalValue?: string }
  }): { graph: SceneGraph; pageId: string; listId: string } {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const stateType = opts.arrayState ?? 'array'
    graph.updateNode(page.id, {
      state: [
        {
          id: 's-users',
          name: 'users',
          type: stateType,
          defaultValue: stateType === 'array' ? [] : 0
        }
      ]
    })
    const dataSourceRef =
      opts.dataSourceRef === undefined
        ? { kind: 'stateRef', stateId: 's-users' }
        : opts.dataSourceRef
    const list = graph.createNode('LIST', page.id, {
      name: 'List',
      width: 200,
      height: 200,
      interactiveProps: {
        dataSourceRef,
        ...(opts.itemName !== undefined ? { itemName: opts.itemName } : {}),
        ...(opts.indexName !== undefined ? { indexName: opts.indexName } : {})
      }
    })
    const childCount = opts.visibleChildren ?? 1
    for (let i = 0; i < childCount; i++) {
      graph.createNode('TEXT', list.id, {
        name: `child-${i}`,
        text: 'fallback',
        ...(i === 0 && opts.childTextBinding !== undefined
          ? { bindings: { text: opts.childTextBinding } }
          : {})
      })
    }
    return { graph, pageId: page.id, listId: list.id }
  }

  test('valid array stateRef + 1 visible child → IRList sits inside the LIST div', () => {
    const { graph, pageId } = makeListGraph({})
    const ir = collectTree(graph, pageId)
    const listEl = ir.children[0] as IRElement
    expect(listEl.kind).toBe('element')
    expect(listEl.tag).toBe('div')
    expect(listEl.children).toHaveLength(1)
    const directive = listEl.children[0] as IRList
    expect(directive.kind).toBe('list')
    expect(directive.arrayName).toBe('users')
    expect(directive.itemName).toBe('item')
    expect(directive.indexName).toBe('index')
    expect(directive.template.kind).toBe('element')
    expect(ir.warnings).toEqual([])
  })

  test('dataSourceRef=null → every authored child is emitted statically', () => {
    const { graph, pageId } = makeListGraph({ dataSourceRef: null })
    const ir = collectTree(graph, pageId)
    const listEl = ir.children[0] as IRElement
    expect(listEl.children).toHaveLength(1)
    expect(listEl.children[0].kind).toBe('element')
    expect((listEl.children[0] as IRElement).children).toEqual([
      { kind: 'text', value: 'fallback' }
    ])
    expect(ir.warnings.some((w) => w.code === 'list-no-datasource')).toBe(false)
  })

  test('dataSourceRef stateId points to a non-array state → list-bad-datasource-type warning', () => {
    const { graph, pageId } = makeListGraph({ arrayState: 'number' })
    const ir = collectTree(graph, pageId)
    const listEl = ir.children[0] as IRElement
    expect(listEl.children).toHaveLength(1)
    expect(ir.warnings.some((w) => w.code === 'list-bad-datasource-type')).toBe(true)
  })

  test('dataSourceRef stateId unknown → list-unknown-datasource warning', () => {
    const { graph, pageId } = makeListGraph({
      dataSourceRef: { kind: 'stateRef', stateId: 'does-not-exist' }
    })
    const ir = collectTree(graph, pageId)
    const listEl = ir.children[0] as IRElement
    expect(listEl.children).toHaveLength(1)
    expect(ir.warnings.some((w) => w.code === 'list-unknown-datasource')).toBe(true)
  })

  test('LIST with 0 visible children → list-no-template warning', () => {
    const { graph, pageId } = makeListGraph({ visibleChildren: 0 })
    const ir = collectTree(graph, pageId)
    const listEl = ir.children[0] as IRElement
    expect(listEl.children).toEqual([])
    expect(ir.warnings.some((w) => w.code === 'list-no-template')).toBe(true)
  })

  test('LIST with 3 visible children → only the first becomes template + list-multiple-templates warning', () => {
    const { graph, pageId } = makeListGraph({ visibleChildren: 3 })
    const ir = collectTree(graph, pageId)
    const listEl = ir.children[0] as IRElement
    expect(listEl.children).toHaveLength(1)
    expect((listEl.children[0] as IRList).kind).toBe('list')
    expect(ir.warnings.some((w) => w.code === 'list-multiple-templates')).toBe(true)
  })

  test('custom itemName / indexName flow into the IRList directive', () => {
    const { graph, pageId } = makeListGraph({ itemName: 'user', indexName: 'i' })
    const ir = collectTree(graph, pageId)
    const listEl = ir.children[0] as IRElement
    const directive = listEl.children[0] as IRList
    expect(directive.itemName).toBe('user')
    expect(directive.indexName).toBe('i')
  })

  test('bindings.text = expr(item.name) inside the template resolves via inScope', () => {
    const { graph, pageId } = makeListGraph({
      childTextBinding: { kind: 'expr', expr: 'item.name' }
    })
    const ir = collectTree(graph, pageId)
    const listEl = ir.children[0] as IRElement
    const directive = listEl.children[0] as IRList
    const tpl = directive.template as IRElement
    expect(tpl.children[0].kind).toBe('expression')
    if (tpl.children[0].kind !== 'expression') throw new Error('expected expression')
    expect(tpl.children[0].references).toEqual(['item'])
    expect(ir.warnings).toEqual([])
  })

  test('bindings.text = expr(undeclared) inside template → binding-unknown-identifier warning + fallback to literal', () => {
    const { graph, pageId } = makeListGraph({
      childTextBinding: { kind: 'expr', expr: 'totallyMissing' }
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'binding-unknown-identifier')).toBe(true)
    const listEl = ir.children[0] as IRElement
    const directive = listEl.children[0] as IRList
    const tpl = directive.template as IRElement
    // Fallback to the static text literal (decision: binding failure does not
    // remove the node, but its dynamic text source is dropped).
    expect(tpl.children[0]).toEqual({ kind: 'text', value: 'fallback' })
  })

  test('item/index identifiers go out of scope outside the LIST template (parent expression cannot see them)', () => {
    // A FRAME outside the LIST tries to use `item.name`; should not resolve.
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-users', name: 'users', type: 'array', defaultValue: [] }]
    })
    graph.createNode('LIST', page.id, {
      name: 'List',
      interactiveProps: { dataSourceRef: { kind: 'stateRef', stateId: 's-users' } }
    })
    // Sibling FRAME with a TEXT that tries to use `item` — out of scope here.
    const sibling = graph.createNode('FRAME', page.id, { name: 'sibling' })
    graph.createNode('TEXT', sibling.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: 'item' } }
    })
    const ir = collectTree(graph, page.id)
    expect(ir.warnings.some((w) => w.code === 'binding-unknown-identifier')).toBe(true)
  })
})
