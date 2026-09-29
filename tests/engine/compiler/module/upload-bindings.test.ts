import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { createUploadButtonModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph, type BindingExpr } from '@open-pencil/scene-graph'

function uploadGraph(binding?: BindingExpr, disabled?: boolean) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [{ id: 'lock', name: 'locked', type: 'boolean', defaultValue: false }]
  })
  const overrides = createUploadButtonModuleFrameOverrides()
  const upload = graph.createNode('FRAME', pageId, {
    ...overrides,
    interactiveProps: { ...overrides.interactiveProps, disabled },
    ...(binding ? { bindings: { disabled: binding } } : {})
  })
  return { graph, pageId, upload }
}

describe('Upload Button authored disabled contract', () => {
  test('retains static disabled without promoting ordinary FRAME disabled props', () => {
    const { graph, pageId } = uploadGraph(undefined, true)
    graph.createNode('FRAME', pageId, { interactiveProps: { disabled: true } })
    const ir = collectTree(graph, pageId)
    expect((ir.children[0] as IRElement).attrs.disabled).toBe(true)
    expect((ir.children[1] as IRElement).attrs.disabled).toBeUndefined()
  })

  test('collects the precise Upload read and keeps unrelated module bindings unavailable', () => {
    const { graph, pageId } = uploadGraph({ kind: 'expr', expr: 'locked' })
    graph.createNode('FRAME', pageId, {
      bindings: { disabled: { kind: 'expr', expr: 'locked' } }
    })
    const ir = collectTree(graph, pageId)
    expect((ir.children[0] as IRElement).module?.uploadDisabledExpr).toEqual({
      kind: 'ident',
      name: 'locked'
    })
    expect((ir.children[1] as IRElement).attrs.disabled).toBeUndefined()
    expect(ir.warnings).toEqual([])
  })

  test.each([
    [{ kind: 'ref', stateId: 'lock' }, 'upload-button-binding-invalid'],
    [{ kind: 'docState', docStateName: 'locked' }, 'upload-button-binding-invalid'],
    [{ kind: 'literal', literalValue: false }, 'upload-button-binding-invalid'],
    [{ kind: 'expr', expr: 'missing' }, 'upload-button-binding-unknown'],
    [{ kind: 'expr', expr: '$prev' }, 'upload-button-binding-prev'],
    [{ kind: 'expr', expr: '(' }, 'upload-button-binding-invalid']
  ] as const)('invalid read %j retains disabled instead of silently enabling', (binding, code) => {
    const { graph, pageId } = uploadGraph(binding)
    const ir = collectTree(graph, pageId)
    expect((ir.children[0] as IRElement).module?.uploadDisabledExpr).toEqual({
      kind: 'ident',
      name: 'true'
    })
    expect(ir.warnings.map((warning) => warning.code)).toContain(code)
  })

  test.each(['react', 'vue'] as const)(
    '%s rejects LIST-local disabled reads instead of emitting an unbound script reference',
    (target) => {
      const graph = new SceneGraph()
      const pageId = graph.getPages()[0].id
      graph.updateNode(pageId, {
        state: [{ id: 'rows', name: 'rows', type: 'array', defaultValue: [{ locked: false }] }]
      })
      const list = graph.createNode('LIST', pageId, {
        interactiveProps: {
          dataSourceRef: { kind: 'stateRef', stateId: 'rows' },
          itemName: 'entry'
        }
      })
      graph.createNode('FRAME', list.id, {
        ...createUploadButtonModuleFrameOverrides(),
        bindings: { disabled: { kind: 'expr', expr: 'entry.locked' } }
      })
      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ target, devMode: false })
      })
      expect(output.warnings.map((warning) => warning.code)).toContain(
        'upload-button-binding-unknown'
      )
      const page = String(
        output.files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
      )
      expect(page).not.toContain('entry.locked')
      expect(page).toContain('true as unknown')
    }
  )

  test.each(['react', 'vue'] as const)(
    '%s registers document state reads for the generated binding',
    (target) => {
      const { graph, pageId, upload } = uploadGraph({ kind: 'expr', expr: 'locked' })
      graph.updateNode(pageId, { state: [] })
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [
          { id: 'doc-lock', name: 'locked', type: 'boolean', defaultValue: true }
        ]
      })
      const output = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ target, devMode: false })
      })
      expect(output.warnings).toEqual([])
      const ir = collectTree(graph, pageId)
      expect(ir.docStateReads).toContain('locked')
      expect((ir.children[0] as IRElement).sourceId).toBe(upload.id)
      const page = String(
        output.files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
      )
      expect(page).toContain(
        target === 'react' ? ' disabled={(() =>' : ':disabled="__opUploadDisabled_'
      )
    }
  )
})
