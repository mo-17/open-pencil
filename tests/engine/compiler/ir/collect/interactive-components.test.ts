import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 2 §8 — the four new interactive components compile to native HTML.
 * `TEXTAREA` / `DATEPICKER` / `SWITCH` are leaf inputs; `RADIO` is a
 * radio-group `<div>` of `<label><input type="radio">…</label>`.
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

  // Phase 3 §3.v7 — min/max range + ISO format validation.
  test('DATEPICKER min/max → emits min + max attrs, no warnings', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('DATEPICKER', pageId, {
      interactiveProps: { value: '2026-06-15', min: '2026-01-01', max: '2026-12-31' }
    })

    const ir = collectTree(graph, pageId)
    const dp = ir.children[0] as IRElement
    expect(dp.attrs.defaultValue).toBe('2026-06-15')
    expect(dp.attrs.min).toBe('2026-01-01')
    expect(dp.attrs.max).toBe('2026-12-31')
    expect(ir.warnings).toEqual([])
  })

  test('DATEPICKER single-sided range emits only the set bound', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('DATEPICKER', pageId, { interactiveProps: { min: '2026-01-01' } })

    const ir = collectTree(graph, pageId)
    const dp = ir.children[0] as IRElement
    expect(dp.attrs.min).toBe('2026-01-01')
    expect(dp.attrs.max).toBeUndefined()
    expect(ir.warnings).toEqual([])
  })

  test('DATEPICKER invalid value → dropped from emit + warning (no-swallow)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('DATEPICKER', pageId, { interactiveProps: { value: '2026-13-45' } })

    const ir = collectTree(graph, pageId)
    const dp = ir.children[0] as IRElement
    expect(dp.attrs.defaultValue).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'datepicker-invalid-value')).toBe(true)
  })

  test('DATEPICKER invalid min → dropped from emit + warning', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('DATEPICKER', pageId, { interactiveProps: { min: 'soon' } })

    const ir = collectTree(graph, pageId)
    const dp = ir.children[0] as IRElement
    expect(dp.attrs.min).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'datepicker-invalid-min')).toBe(true)
  })

  test('DATEPICKER inverted range → both attrs still emitted + warning (decision §3.v7.2 h)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('DATEPICKER', pageId, {
      interactiveProps: { min: '2026-12-31', max: '2026-01-01' }
    })

    const ir = collectTree(graph, pageId)
    const dp = ir.children[0] as IRElement
    expect(dp.attrs.min).toBe('2026-12-31')
    expect(dp.attrs.max).toBe('2026-01-01')
    expect(ir.warnings.some((w) => w.code === 'datepicker-range-inverted')).toBe(true)
  })

  test('DATEPICKER value out of range → kept + warning (decision §3.v7.2 h)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('DATEPICKER', pageId, {
      interactiveProps: { value: '2025-06-15', min: '2026-01-01' }
    })

    const ir = collectTree(graph, pageId)
    const dp = ir.children[0] as IRElement
    expect(dp.attrs.defaultValue).toBe('2025-06-15')
    expect(ir.warnings.some((w) => w.code === 'datepicker-value-out-of-range')).toBe(true)
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

  test('SWITCH className → §3.v5 full CSS (cqw slide tween + fixed colors + dark)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('SWITCH', pageId)

    const ir = collectTree(graph, pageId)
    const sw = ir.children[0] as IRElement
    // container query unit anchor + smooth translate-x tween (replaces the
    // §3.v4 left↔right anchor swap, which couldn't animate).
    expect(sw.className).toContain('[container-type:size]')
    expect(sw.className).toContain('before:transition-transform')
    expect(sw.className).toContain('checked:before:translate-x-[calc(100cqw_-_100cqh)]')
    // Fixed off/on colors with dark variants — not derived from the (gray) fill.
    expect(sw.className).toContain('bg-gray-300')
    expect(sw.className).toContain('dark:bg-gray-600')
    expect(sw.className).toContain('checked:bg-blue-500')
    expect(sw.className).toContain('dark:checked:bg-blue-400')
    // The §3.v4 anchor-swap tokens are gone.
    expect(sw.className).not.toContain('checked:before:right-[5%]')
    expect(sw.className).not.toContain('before:left-[5%]')
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

  test('RADIO → <div> of <label><input type="radio">…</label>, checked option marked', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RADIO', pageId, {
      interactiveProps: { options: ['Yes', 'No'], value: 'No', groupName: 'answer' }
    })

    const ir = collectTree(graph, pageId)
    const radio = ir.children[0] as IRElement
    expect(radio.tag).toBe('div')
    expect(radio.children).toHaveLength(2)

    const firstLabel = radio.children[0] as IRElement
    expect(firstLabel.tag).toBe('label')
    const firstInput = firstLabel.children[0] as IRElement
    expect(firstInput.tag).toBe('input')
    expect(firstInput.attrs).toEqual({ type: 'radio', value: 'Yes', name: 'answer' })
    expect(firstLabel.children[1]).toEqual({ kind: 'text', value: 'Yes' })

    const secondInput = (radio.children[1] as IRElement).children[0] as IRElement
    // 'No' matches interactiveProps.value → defaultChecked.
    expect(secondInput.attrs).toEqual({
      type: 'radio',
      value: 'No',
      name: 'answer',
      defaultChecked: true
    })
  })

  test('RADIO with default props (empty options) → empty <div>', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RADIO', pageId)

    const ir = collectTree(graph, pageId)
    const radio = ir.children[0] as IRElement
    expect(radio.tag).toBe('div')
    expect(radio.children).toEqual([])
  })

  test('RADIO without a groupName → input has no name attr', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RADIO', pageId, {
      interactiveProps: { options: ['A'], value: '', groupName: '' }
    })

    const ir = collectTree(graph, pageId)
    const input = ((ir.children[0] as IRElement).children[0] as IRElement)
      .children[0] as IRElement
    expect(input.attrs).toEqual({ type: 'radio', value: 'A' })
  })

  test('§3.v5 — RADIO option label/input get inline-layout classes', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RADIO', pageId, { interactiveProps: { options: ['A', 'B'] } })

    const radio = collectTree(graph, pageId).children[0] as IRElement
    const label = radio.children[0] as IRElement
    const input = label.children[0] as IRElement
    expect(label.className).toBe('inline-flex items-center gap-2 cursor-pointer')
    expect(input.className).toBe('shrink-0 accent-blue-500 dark:accent-blue-400')
  })

  test('§3.v5 — FREE-positioned RADIO wrapper gets flex-col fallback', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RADIO', pageId, { interactiveProps: { options: ['A'] } })

    const radio = collectTree(graph, pageId).children[0] as IRElement
    expect(radio.className).toContain('flex flex-col gap-2')
  })

  test('§3.v5 — auto-layout RADIO wrapper keeps the user direction (no fallback)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RADIO', pageId, {
      layoutMode: 'HORIZONTAL',
      interactiveProps: { options: ['A'] }
    })

    const radio = collectTree(graph, pageId).children[0] as IRElement
    expect(radio.className).toContain('flex')
    expect(radio.className).not.toContain('flex flex-col gap-2')
  })

  test('§3.v5 — CHECKBOX-group wrapper + option labels get layout classes', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('CHECKBOX', pageId, { interactiveProps: { options: ['X', 'Y'] } })

    const group = collectTree(graph, pageId).children[0] as IRElement
    expect(group.tag).toBe('div')
    expect(group.className).toContain('flex flex-col gap-2')
    expect((group.children[0] as IRElement).className).toBe(
      'inline-flex items-center gap-2 cursor-pointer'
    )
  })
})
