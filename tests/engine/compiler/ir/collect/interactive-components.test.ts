import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 2 §8 — the four new interactive components compile to native HTML.
 * `TEXTAREA` / `DATEPICKER` / `SWITCH` are leaf inputs; `RADIO` is a
 * radio-group node (covered in `radio.test.ts`).
 */
describe('collectTree — Phase 2 §8 interactive components', () => {
  test('TEXTAREA → <textarea> with placeholder + defaultValue', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('TEXTAREA', pageId, {
      interactiveProps: { placeholder: 'Notes', value: 'draft' }
    })

    const ir = collectTree(graph, pageId)
    const ta = ir.children[0] as IRElement
    expect(ta.tag).toBe('textarea')
    expect(ta.attrs.placeholder).toBe('Notes')
    expect(ta.attrs.defaultValue).toBe('draft')
    expect(ta.children).toEqual([])
  })

  test('TEXTAREA with default props → placeholder, no defaultValue (empty value)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('TEXTAREA', pageId)

    const ir = collectTree(graph, pageId)
    const ta = ir.children[0] as IRElement
    expect(ta.tag).toBe('textarea')
    expect(ta.attrs.placeholder).toBe('Enter text')
    expect(ta.attrs.defaultValue).toBeUndefined()
  })

  test('DATEPICKER → <input type="date">', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('DATEPICKER', pageId, { interactiveProps: { value: '2026-05-23' } })

    const ir = collectTree(graph, pageId)
    const dp = ir.children[0] as IRElement
    expect(dp.tag).toBe('input')
    expect(dp.attrs.type).toBe('date')
    expect(dp.attrs.defaultValue).toBe('2026-05-23')
  })

  test('DATEPICKER with empty value → no defaultValue attr', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('DATEPICKER', pageId)

    const ir = collectTree(graph, pageId)
    const dp = ir.children[0] as IRElement
    expect(dp.attrs.type).toBe('date')
    expect(dp.attrs.defaultValue).toBeUndefined()
  })

  test('SWITCH → <input type="checkbox" role="switch">', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('SWITCH', pageId, { interactiveProps: { checked: true } })

    const ir = collectTree(graph, pageId)
    const sw = ir.children[0] as IRElement
    expect(sw.tag).toBe('input')
    expect(sw.attrs.type).toBe('checkbox')
    expect(sw.attrs.role).toBe('switch')
    expect(sw.attrs.defaultChecked).toBe(true)
  })

  test('SWITCH unchecked → no defaultChecked attr', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('SWITCH', pageId)

    const ir = collectTree(graph, pageId)
    const sw = ir.children[0] as IRElement
    expect(sw.attrs.role).toBe('switch')
    expect(sw.attrs.defaultChecked).toBeUndefined()
  })
})
