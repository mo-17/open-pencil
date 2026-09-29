import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  createDateRangeModuleFrameOverrides,
  createRatingModuleFrameOverrides,
  createSliderModuleFrameOverrides,
  moduleValueFields
} from '@open-pencil/core/plugins'

import { inspectFormOverview } from '@/app/lowcode/form-overview'
import {
  moduleBindingFromSelection,
  moduleBindingOptions,
  moduleBindingSelection
} from '@/app/lowcode/value-controls/form/fields'
import { useModuleValueSession } from '@/app/lowcode/value-controls/form/session'

test('module binding choices accept exact writable endpoint types and preserve invalid bindings explicitly', () => {
  const editor = createEditor(),
    graph = editor.graph,
    page = editor.state.currentPageId
  try {
    graph.updateNode(page, {
      state: [
        { id: 'number', name: 'count', type: 'number', defaultValue: 2 },
        {
          id: 'computed',
          name: 'computed',
          type: 'number',
          defaultValue: 4,
          computedExpr: '2 + 2'
        },
        { id: 'text', name: 'date', type: 'string', defaultValue: '' }
      ]
    })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'doc', name: 'score', type: 'number', defaultValue: 3 }]
    })
    const slider = graph.createNode(
      'FRAME',
      page,
      createSliderModuleFrameOverrides({ range: true })
    )
    const date = graph.createNode('FRAME', page, createDateRangeModuleFrameOverrides())
    const fields = moduleValueFields(slider)
    expect(fields.map(({ key, type, validationKey }) => ({ key, type, validationKey }))).toEqual([
      { key: 'value', type: 'number', validationKey: 'validation' },
      { key: 'endValue', type: 'number', validationKey: 'endValidation' }
    ])
    const options = moduleBindingOptions(graph, slider, page, fields[0], 'Page', 'Document')
    expect(options.map((option) => option.value)).toEqual(['state:number', 'doc:score'])
    expect(
      moduleBindingOptions(graph, date, page, moduleValueFields(date)[0], 'Page', 'Document').map(
        (option) => option.value
      )
    ).toEqual(['state:text'])
    expect(moduleBindingFromSelection('state:computed', options)).toBeNull()
    expect(moduleBindingFromSelection('expression', options)).toBeNull()
    expect(moduleBindingFromSelection('uncontrolled', options)).toBeUndefined()
    expect(moduleBindingFromSelection('doc:score', options)).toEqual({
      kind: 'docState',
      docStateName: 'score'
    })
    expect(moduleBindingSelection({ kind: 'ref', stateId: 'deleted' }, options)).toBe('invalid')
    expect(moduleBindingSelection({ kind: 'expr', expr: 'count' }, options)).toBe('invalid')
    expect(moduleBindingSelection(undefined, options)).toBe('uncontrolled')
    const master = graph.createNode('COMPONENT', page)
    graph.reparentNode(slider.id, master.id)
    expect(
      moduleBindingOptions(graph, slider, page, fields[0], 'Page', 'Document').map(
        (option) => option.value
      )
    ).toEqual(['doc:score'])
  } finally {
    editor.dispose()
  }
})

for (const boundary of ['owner', 'same-id', 'config', 'binding', 'retained', 'dispose'] as const)
  test(`module field callbacks lose authority across ${boundary}`, () => {
    const editor = createEditor()
    const node = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createRatingModuleFrameOverrides()
    )
    const owner = shallowRef(node),
      source = shallowRef({ bindings: node.bindings, props: node.interactiveProps }),
      active = ref(true),
      scope = effectScope()
    const session = scope.run(() =>
      useModuleValueSession(
        () => owner.value,
        () => source.value,
        active
      )
    )
    if (!session) throw new Error('Missing session')
    try {
      const version = session.version.value
      expect(session.request(version)?.owner).toBe(node)
      if (boundary === 'owner')
        owner.value = editor.graph.createNode('FRAME', editor.state.currentPageId)
      if (boundary === 'same-id') owner.value = structuredClone(node)
      if (boundary === 'config') {
        const module = node.interactiveProps?.module
        if (!module) throw new Error('Missing module')
        module.config.initialValue = 1
      }
      if (boundary === 'binding')
        source.value = {
          ...source.value,
          bindings: { value: { kind: 'ref', stateId: 'different' } }
        }
      if (boundary === 'retained') {
        active.value = false
        active.value = true
      }
      if (boundary === 'dispose') scope.stop()
      expect(session.request(version)).toBeUndefined()
      // An interaction in the new render must never authorize the old render.
      session.request(session.version.value)
      expect(session.request(version)).toBeUndefined()
    } finally {
      scope.stop()
      editor.dispose()
    }
  })

test('FORM overview distinguishes both module endpoints and their own binding and validation', () => {
  const editor = createEditor(),
    graph = editor.graph,
    page = editor.state.currentPageId
  try {
    graph.updateNode(page, {
      state: [
        { id: 'start', name: 'start', type: 'number', defaultValue: 20 },
        { id: 'end', name: 'end', type: 'number', defaultValue: 80 }
      ]
    })
    const form = graph.createNode('FORM', page)
    const frame = createSliderModuleFrameOverrides({ range: true })
    const slider = graph.createNode('FRAME', form.id, {
      ...frame,
      bindings: {
        value: { kind: 'ref', stateId: 'start' },
        endValue: { kind: 'ref', stateId: 'missing' }
      },
      interactiveProps: {
        ...frame.interactiveProps,
        validation: { min: 10 },
        endValidation: { required: true }
      }
    })
    const before = editor.snapshotDocument()
    expect(inspectFormOverview(graph, slider.id)?.fields).toEqual([
      {
        id: slider.id,
        name: slider.name,
        valueKey: 'value',
        binding: 'valid',
        validation: 'configured',
        asynchronous: false
      },
      {
        id: slider.id,
        name: slider.name,
        valueKey: 'endValue',
        binding: 'invalid',
        validation: 'configured',
        asynchronous: false
      }
    ])
    expect(editor.documentSnapshotChanged(before)).toBe(false)
  } finally {
    editor.dispose()
  }
})

test('module choices reject computed document state and every ambiguous state id or name', () => {
  const editor = createEditor(),
    graph = editor.graph,
    pageId = editor.state.currentPageId
  const declarations = [
    { id: 'safe', name: 'safe', type: 'number' as const, defaultValue: 1 },
    {
      id: 'computed',
      name: 'computed',
      type: 'number' as const,
      defaultValue: 1,
      computedExpr: '1'
    },
    { id: 'same-id', name: 'first', type: 'number' as const, defaultValue: 1 },
    { id: 'same-id', name: 'second', type: 'string' as const, defaultValue: '' },
    { id: 'first-name', name: 'repeated', type: 'number' as const, defaultValue: 1 },
    { id: 'second-name', name: 'repeated', type: 'number' as const, defaultValue: 2 }
  ]
  try {
    graph.updateNode(pageId, { state: declarations })
    graph.updateNode(graph.rootId, { lowcodeDocumentState: declarations })
    const node = graph.createNode('FRAME', pageId, createRatingModuleFrameOverrides())
    const options = moduleBindingOptions(
      graph,
      node,
      pageId,
      moduleValueFields(node)[0],
      'Page',
      'Document'
    )
    expect(options.map((option) => option.value)).toEqual(['state:safe', 'doc:safe'])
    for (const id of ['computed', 'same-id', 'first-name', 'second-name']) {
      expect(moduleBindingSelection({ kind: 'ref', stateId: id }, options)).toBe('invalid')
      expect(moduleBindingFromSelection('state:' + id, options)).toBeNull()
    }
    for (const name of ['computed', 'first', 'second', 'repeated']) {
      expect(moduleBindingSelection({ kind: 'docState', docStateName: name }, options)).toBe(
        'invalid'
      )
      expect(moduleBindingFromSelection('doc:' + name, options)).toBeNull()
    }
  } finally {
    editor.dispose()
  }
})
