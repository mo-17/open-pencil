import { expect, test } from 'bun:test'

import { effectScope, nextTick, reactive, ref } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import type { ActionDef, StateDef } from '@open-pencil/scene-graph'
import { SceneGraph } from '@open-pencil/scene-graph'

import { inspectFormOverview } from '@/app/lowcode/form-overview'
import { inspectFormSubmission } from '@/app/lowcode/form-overview/submission'
import { useFormOverviewReveal } from '@/app/lowcode/form-overview/use-reveal'

function fixture() {
  const editor = createEditor()
  const graph = editor.graph
  const form = graph.createNode('FORM', editor.state.currentPageId, { name: 'Profile' })
  return { editor, graph, form }
}

test('form overview distinguishes optional configuration from invalid bindings without mutating the document', () => {
  const { editor, graph, form } = fixture()
  graph.updateNode(editor.state.currentPageId, {
    state: [{ id: 'name', name: 'name', type: 'string', defaultValue: '' }]
  })
  const good = graph.createNode('INPUT', form.id, {
    name: 'Name',
    bindings: { value: { kind: 'ref', stateId: 'name' } },
    interactiveProps: { validation: { required: true } }
  })
  const optional = graph.createNode('INPUT', form.id, { name: 'Optional' })
  const broken = graph.createNode('INPUT', form.id, {
    name: 'Broken',
    bindings: { value: { kind: 'ref', stateId: 'gone' } },
    interactiveProps: { validation: { pattern: '[' } }
  })
  const before = editor.snapshotDocument()
  const result = inspectFormOverview(graph, good.id)
  expect(result?.formId).toBe(form.id)
  expect(result?.fields).toEqual([
    { id: good.id, name: 'Name', binding: 'valid', validation: 'configured', asynchronous: false },
    {
      id: optional.id,
      name: 'Optional',
      binding: 'missing',
      validation: 'none',
      asynchronous: false
    },
    {
      id: broken.id,
      name: 'Broken',
      binding: 'invalid',
      validation: 'invalid',
      asynchronous: false
    }
  ])
  expect(result?.submission.actions).toBe(0)
  expect(editor.documentSnapshotChanged(before)).toBe(false)
  expect(editor.undo.canUndo).toBe(false)
})

test('component-master document bindings remain legal while page-state bindings are invalid', () => {
  const { editor, graph, form } = fixture()
  const master = graph.createNode('COMPONENT', editor.state.currentPageId)
  graph.reparentNode(form.id, master.id)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'doc', name: 'email', type: 'string', defaultValue: '' }]
  })
  graph.updateNode(editor.state.currentPageId, {
    state: [{ id: 'page', name: 'email', type: 'string', defaultValue: '' }]
  })
  graph.createNode('INPUT', form.id, {
    bindings: { value: { kind: 'docState', docStateName: 'email' } },
    interactiveProps: { validation: { required: true } }
  })
  graph.createNode('INPUT', form.id, {
    bindings: { value: { kind: 'ref', stateId: 'page' } },
    interactiveProps: { validation: { required: true } }
  })
  expect(inspectFormOverview(graph, form.id)?.fields.map((field) => field.binding)).toEqual([
    'valid',
    'invalid'
  ])
})

test('separates parent and nested forms, flags async rules and click actions without treating onSuccess as failure handling', () => {
  const { graph, form } = fixture()
  const nested = graph.createNode('FORM', form.id)
  graph.createNode('INPUT', nested.id)
  graph.createNode('INPUT', form.id, {
    interactiveProps: { validation: { async: { url: 'https://example.com/check' } } }
  })
  const button = graph.createNode('BUTTON', form.id, {
    events: { onClick: [{ id: 'click', kind: 'toast', messageExpr: '"Clicked"' }] }
  })
  graph.updateNode(form.id, {
    events: {
      onSubmit: [
        {
          id: 'request',
          kind: 'backendRequest',
          resourceId: 'notes',
          operation: 'create',
          onSuccess: [{ id: 'clear', kind: 'setState', targetStateId: 'name', valueExpr: '""' }]
        }
      ]
    }
  })
  const result = inspectFormOverview(graph, form.id)
  expect(result?.fields).toHaveLength(1)
  expect(result?.fields[0].asynchronous).toBe(true)
  expect(result?.clickButtons[0]).toMatchObject({ id: button.id, actionId: 'click' })
  expect(result?.submission).toMatchObject({
    requests: 1,
    handled: 0,
    customFailure: false,
    attentionPath: 'onSubmit[0]'
  })
  expect(inspectFormOverview(graph, nested.id)?.fields).toHaveLength(1)
})

test('nested request navigation matches ActionRow paths and a custom error branch makes no retention guarantee', () => {
  const actions: ActionDef[] = [
    {
      id: 'condition',
      kind: 'condition',
      condExpr: 'true',
      consequent: [
        { id: 'request', kind: 'backendRequest', resourceId: 'notes', operation: 'create' }
      ],
      alternate: [
        {
          id: 'other',
          kind: 'backendRequest',
          resourceId: 'notes',
          operation: 'create',
          onError: [{ id: 'clear', kind: 'setState', targetStateId: 'draft', valueExpr: '""' }]
        }
      ]
    }
  ]
  expect(inspectFormSubmission(actions, [])).toMatchObject({
    requests: 2,
    handled: 1,
    customFailure: true,
    attentionPath: 'onSubmit[0]/consequent[0]',
    attentionActionId: 'request'
  })
})

test('backend error targets must have the exact writable non-persistent string contract', () => {
  const states: StateDef[] = [
    { id: 'ok', name: 'error', type: 'string', defaultValue: '' },
    { id: 'bad', name: 'number', type: 'number', defaultValue: 0 },
    { id: 'persisted', name: 'persisted', type: 'string', defaultValue: '', persist: true },
    { id: 'computed', name: 'computed', type: 'string', defaultValue: '', computedExpr: '"error"' }
  ]
  const actions: ActionDef[] = states.map((state) => ({
    id: state.id,
    kind: 'backendRequest',
    resourceId: 'notes',
    operation: 'create',
    errorTarget: state.name
  }))
  expect(inspectFormSubmission(actions, states)).toMatchObject({
    requests: 4,
    handled: 1,
    invalidTargets: 3
  })
  expect(
    inspectFormSubmission(
      [
        {
          id: 'spaced',
          kind: 'apiCall',
          url: '/api/profile',
          method: 'POST',
          targetName: 'error',
          errorTarget: ' error '
        }
      ],
      states
    )
  ).toMatchObject({ handled: 0, invalidTargets: 1 })
  expect(
    inspectFormSubmission([{ id: 'workflow', kind: 'callWorkflow', workflowId: 'save' }], states)
  ).toMatchObject({ workflow: true, requests: 0, handled: 0 })
})

test('bounded overview does not imply all fields were checked and unrelated selection has no form state', () => {
  const { graph, form, editor } = fixture()
  for (let index = 0; index < 201; index++) graph.createNode('INPUT', form.id)
  expect(inspectFormOverview(graph, form.id)).toMatchObject({ truncated: true })
  expect(inspectFormOverview(graph, form.id)?.fields).toHaveLength(200)
  const unrelated = graph.createNode('RECTANGLE', editor.state.currentPageId)
  expect(inspectFormOverview(graph, unrelated.id)).toBeNull()
  expect(
    inspectFormSubmission(
      Array.from({ length: 201 }, (_, index) => ({ id: `${index}`, kind: 'stop' })),
      []
    ).truncated
  ).toBe(true)
})

test.each(['graph', 'selection'] as const)(
  'a late inspector reveal is invalidated after %s changes',
  async (change) => {
    const { editor, form, graph } = fixture()
    const field = graph.createNode('INPUT', form.id)
    const selected = ref(graph.getNode(field.id))
    const state = reactive({ sceneVersion: 0 })
    const frames: FrameRequestCallback[] = []
    const originalFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (callback) => {
      frames.push(callback)
      return frames.length
    }
    const scope = effectScope()
    try {
      const reveal = scope.run(() =>
        useFormOverviewReveal(
          {
            get graph() {
              return editor.graph
            },
            state,
            select(ids) {
              editor.select(ids)
              selected.value = editor.graph.getNode(ids[0])
            }
          },
          selected,
          ref(1),
          ref('')
        )
      )
      if (!reveal) throw new Error('Scope did not create the reveal workflow')
      const pending = reveal.reveal({ nodeId: field.id, section: 'lowcode-validation' })
      await nextTick()
      expect(frames).toHaveLength(1)
      expect(reveal.isRevealedSection('lowcode-validation')).toBe(true)
      if (change === 'graph') {
        editor.replaceGraph(new SceneGraph())
        state.sceneVersion++
      } else selected.value = form
      frames[0](0)
      await pending
      expect(reveal.isRevealedSection('lowcode-validation')).toBe(false)
    } finally {
      scope.stop()
      if (originalFrame) globalThis.requestAnimationFrame = originalFrame
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    }
  }
)

test.each(['RADIO', 'SELECT', 'INPUT'] as const)(
  '%s binding navigation reveals its actual inspector section without changing authored data',
  async (type) => {
    const { editor, form, graph } = fixture()
    const field = graph.createNode(type, form.id)
    const selected = ref(graph.getNode(form.id))
    const filter = ref('an unrelated filter')
    const frames: FrameRequestCallback[] = []
    const originalFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (callback) => {
      frames.push(callback)
      return frames.length
    }
    const scope = effectScope()
    try {
      const before = editor.snapshotDocument()
      const reveal = scope.run(() =>
        useFormOverviewReveal(
          {
            graph,
            state: reactive({ sceneVersion: 0 }),
            select(ids) {
              editor.select(ids)
              selected.value = graph.getNode(ids[0])
            }
          },
          selected,
          ref(1),
          filter
        )
      )
      if (!reveal) throw new Error('Scope did not create the reveal workflow')
      const pending = reveal.reveal({ nodeId: field.id, section: 'lowcode-bindings' })
      await nextTick()
      expect(frames).toHaveLength(1)
      expect(filter.value).toBe('')
      const destination = type !== 'INPUT' ? 'lowcode-control' : 'lowcode-bindings'
      const other = type !== 'INPUT' ? 'lowcode-bindings' : 'lowcode-control'
      expect(reveal.isRevealedSection(destination)).toBe(true)
      expect(reveal.isRevealedSection(other)).toBe(false)
      frames[0](0)
      await pending
      expect(editor.documentSnapshotChanged(before)).toBe(false)
      selected.value = form
      expect(reveal.isRevealedSection(destination)).toBe(false)
    } finally {
      scope.stop()
      if (originalFrame) globalThis.requestAnimationFrame = originalFrame
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    }
  }
)
