import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  CHART_MODULE_DEFAULT_CONFIG,
  createChartModuleFrameOverrides
} from '@open-pencil/core/plugins'
import { readModuleInstance } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  chartDataRows,
  commitChartData,
  parseChartData,
  type ChartDataCommit
} from '@/app/lowcode/chart-editor'
import { chartEditorCopy } from '@/app/lowcode/chart-editor/copy'
import { useChartDataDraft } from '@/app/lowcode/chart-editor/use'
import { feedbackPropertyVisible } from '@/app/lowcode/feedback-controls/properties'

test('chart data pairs preserve blank and invalid numeric drafts and enforce bounded decimal data', () => {
  const config = structuredClone(CHART_MODULE_DEFAULT_CONFIG)
  for (const value of ['', ' ', '-', '1e', '0x10', 'Infinity', 'NaN', '1,000', '1000001']) {
    const rows = [{ label: '项目', value }]
    expect(parseChartData(config, rows)).toEqual({ ok: false, error: 'value' })
    expect(rows[0].value).toBe(value)
  }
  expect(
    parseChartData(config, [
      { label: '负值', value: '-12.5' },
      { label: '指数', value: '2e2' }
    ])
  ).toEqual({ ok: true, labels: ['负值', '指数'], values: [-12.5, 200] })
  expect(parseChartData(config, [])).toEqual({ ok: false, error: 'count' })
  expect(
    parseChartData(
      config,
      Array.from({ length: 65 }, () => ({ label: 'A', value: '1' }))
    )
  ).toEqual({ ok: false, error: 'count' })
  expect(parseChartData(config, [{ label: 'x'.repeat(81), value: '1' }])).toEqual({
    ok: false,
    error: 'label'
  })
  for (const chartType of ['pie', 'donut'])
    expect(parseChartData({ ...config, chartType }, [{ label: 'A', value: '-1' }])).toEqual({
      ok: false,
      error: 'negative'
    })
})

test('paired chart data is one undo entry and stale or protected owners reject the complete edit', () => {
  const editor = createEditor()
  try {
    const owner = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createChartModuleFrameOverrides()
    )
    editor.select([owner.id])
    editor.undo.clear()
    const before = structuredClone(owner.interactiveProps)
    const request: ChartDataCommit = {
      owner,
      previousModule: structuredClone(owner.interactiveProps?.module),
      value: [{ label: '新标签', value: '42.5' }]
    }
    expect(commitChartData(editor, request)).toBe(true)
    expect(readModuleInstance(owner.interactiveProps?.module)?.config).toMatchObject({
      labels: ['新标签'],
      values: [42.5]
    })
    expect(commitChartData(editor, request)).toBe(false)
    editor.undo.undo()
    expect(owner.interactiveProps).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
    expect(commitChartData(editor, { ...request, value: [{ label: 'Invalid', value: '' }] })).toBe(
      false
    )
    editor.graph.updateNode(owner.id, { locked: true })
    expect(commitChartData(editor, request)).toBe(false)
    editor.graph.updateNode(owner.id, { locked: false })
    editor.clearSelection()
    expect(commitChartData(editor, request)).toBe(false)
    expect(owner.interactiveProps).toEqual(before)
  } finally {
    editor.dispose()
  }
})

function draftFixture() {
  const editor = createEditor()
  const first = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createChartModuleFrameOverrides()
  )
  const second = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createChartModuleFrameOverrides()
  )
  const owner = shallowRef(first)
  const config = shallowRef<JSONObject>(structuredClone(CHART_MODULE_DEFAULT_CONFIG))
  const active = ref(true)
  const requests: ChartDataCommit[] = []
  const scope = effectScope()
  const draft = scope.run(() =>
    useChartDataDraft(
      () => owner.value,
      () => config.value,
      (request) => requests.push(request),
      active
    )
  )
  if (!draft) throw new Error('Missing chart draft scope')
  return {
    editor,
    first,
    second,
    owner,
    config,
    active,
    requests,
    scope,
    draft,
    dispose: () => {
      scope.stop()
      editor.dispose()
    }
  }
}

test('manual chart drafts retain invalid values and pair add/remove until apply or cancel', () => {
  const fixture = draftFixture()
  const { draft, requests } = fixture
  try {
    const generation = draft.generation.value
    const key = draft.rows.value[0].key
    draft.beginInput(key, generation)
    draft.input(key, 'label', '中文')
    draft.input(key, 'value', 'invalid')
    draft.add('New item', generation)
    expect(draft.rows.value).toHaveLength(5)
    expect(requests).toHaveLength(0)
    draft.apply(generation)
    expect(draft.error.value).toBe('value')
    expect(draft.rows.value[0].value).toBe('invalid')
    draft.beginInput(key, generation)
    draft.input(key, 'value', '5.5')
    draft.apply(generation)
    expect(requests).toHaveLength(1)
    expect(requests[0].value[0]).toEqual({ label: '中文', value: '5.5' })
    draft.cancel(generation)
    expect(draft.dirty.value).toBe(false)
    expect(draft.rows.value.map(({ label, value }) => ({ label, value }))).toEqual(
      chartDataRows(fixture.config.value)
    )
    for (let i = 0; i < 70; i++) draft.add('A', draft.generation.value)
    expect(draft.rows.value).toHaveLength(64)
    for (let i = 0; i < 70; i++) draft.remove(draft.rows.value[0].key, draft.generation.value)
    expect(draft.rows.value).toHaveLength(1)
  } finally {
    fixture.dispose()
  }
})

for (const boundary of ['selection', 'replacement', 'config', 'pause', 'disposal'] as const) {
  test(`chart ${boundary} invalidates old inputs and action generations`, () => {
    const fixture = draftFixture()
    const { draft, requests } = fixture
    try {
      const key = draft.rows.value[0].key
      const generation = draft.generation.value
      draft.beginInput(key, generation)
      draft.input(key, 'value', '999')
      if (boundary === 'selection') fixture.owner.value = fixture.second
      if (boundary === 'replacement') fixture.owner.value = structuredClone(fixture.first)
      if (boundary === 'config')
        fixture.config.value = { ...fixture.config.value, color: '#FF0000' }
      if (boundary === 'pause') {
        fixture.active.value = false
        fixture.active.value = true
      }
      if (boundary === 'disposal') fixture.scope.stop()
      draft.beginInput(key, generation)
      draft.input(key, 'value', '888')
      draft.add('Late', generation)
      draft.remove(key, generation)
      draft.apply(generation)
      expect(requests).toEqual([])
    } finally {
      fixture.dispose()
    }
  })
}

test('chart draft cannot overwrite a changed live module before its props refresh', () => {
  const fixture = draftFixture()
  try {
    const { draft } = fixture
    const generation = draft.generation.value
    const key = draft.rows.value[0].key
    draft.beginInput(key, generation)
    draft.input(key, 'value', '99')
    fixture.editor.graph.updateNode(
      fixture.first.id,
      createChartModuleFrameOverrides({ values: [8], labels: ['Collaborator'] })
    )
    draft.apply(generation)
    expect(fixture.requests).toEqual([])
  } finally {
    fixture.dispose()
  }
})

test('chart data visibility and validation messages support paired authoring', () => {
  expect(feedbackPropertyVisible('open-pencil.chart', 'labels', {})).toBe(false)
  expect(feedbackPropertyVisible('open-pencil.chart', 'values', {})).toBe(true)
  expect(feedbackPropertyVisible('external.chart', 'labels', {})).toBe(true)
  expect(chartEditorCopy('zh-CN').errors.negative).toContain('非负')
  expect(chartEditorCopy('en').errors.negative).toContain('non-negative')
})
