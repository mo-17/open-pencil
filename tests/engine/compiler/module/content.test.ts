import { beforeAll, describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement, IRNode } from '#compiler/ir/types'
import { moduleContentNodes } from '#compiler/modules/content-slots'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import {
  createModalModuleInstance,
  createTabsModuleInstance,
  resolveModalModule,
  resolveTabsModule
} from '@open-pencil/core/plugins'

import { compositionFiles, compositionGraph } from '#tests/helpers/compiler/components/composition'

function findElement(nodes: readonly IRNode[], sourceId: string): IRElement {
  const node = nodes.find((entry) => entry.kind === 'element' && entry.sourceId === sourceId)
  if (node?.kind !== 'element') throw new Error('Missing module element')
  return node
}

describe('explicit module child content', () => {
  beforeAll(initCodec)
  test('keeps old bounded text contracts and accepts only bounded optional child names', () => {
    expect(resolveModalModule(createModalModuleInstance())?.ok).toBe(true)
    expect(resolveTabsModule(createTabsModuleInstance())?.ok).toBe(true)
    expect(() => createModalModuleInstance({ contentChildName: 'x'.repeat(121) })).toThrow()
    expect(() =>
      createTabsModuleInstance({
        tabs: [
          { id: 'one', label: 'One', content: '', contentChildName: '<div>' },
          { id: 'two', label: 'Two', content: '', renderHTML: '<div>' }
        ]
      })
    ).toThrow()
  })
  test('maps unique names independent of order and retains nested validation and list data dependencies', () => {
    const fixture = compositionGraph()
    const ir = collectTree(fixture.graph, fixture.pageId)
    expect(findElement(ir.children, fixture.modal.id).module?.contentSlots).toEqual([
      { name: 'content', sourceId: fixture.modalBody.id }
    ])
    expect(findElement(ir.children, fixture.tabs.id).module?.contentSlots).toEqual([
      { name: 'panel-profile', sourceId: fixture.tabBody.id },
      { name: 'panel-rows', sourceId: fixture.list.id }
    ])
    expect(ir.docStateReads).toContain('rows')
    expect(ir.docStateWrites).toContain('status')
    expect(ir.validatedFields?.length).toBe(2)
    expect(ir.warnings).toEqual([])
    fixture.graph.reorderChild(fixture.tabs.id, fixture.list.id, 0)
    expect(
      findElement(collectTree(fixture.graph, fixture.pageId).children, fixture.tabs.id).module
        ?.contentSlots
    ).toEqual(findElement(ir.children, fixture.tabs.id).module?.contentSlots)
  })
  test('fails closed for renamed, missing, duplicate or shared child mappings', () => {
    for (const failure of ['rename', 'duplicate', 'shared', 'hidden'] as const) {
      const { graph, pageId, modal, modalBody, tabs } = compositionGraph()
      if (failure === 'rename') graph.updateNode(modalBody.id, { name: 'Renamed body' })
      if (failure === 'duplicate') graph.createNode('FRAME', modal.id, { name: modalBody.name })
      if (failure === 'hidden') graph.updateNode(modalBody.id, { visible: false })
      if (failure === 'shared')
        graph.updateNode(tabs.id, {
          interactiveProps: {
            module: createTabsModuleInstance({
              tabs: [
                { id: 'one', label: 'One', content: '', contentChildName: 'Tab form' },
                { id: 'two', label: 'Two', content: '', contentChildName: 'Tab form' }
              ],
              initialTabId: 'one'
            })
          }
        })
      const ir = collectTree(graph, pageId)
      expect(ir.warnings.some((warning) => warning.code === 'module-content-child-invalid')).toBe(
        true
      )
      const slots = findElement(ir.children, failure === 'shared' ? tabs.id : modal.id).module
        ?.contentSlots
      expect(slots?.every((slot) => slot.sourceId === null)).toBe(true)
    }
  })
  test('clearing explicit content mappings keeps text mode without exposing unassigned children', () => {
    const { graph, pageId, modal } = compositionGraph()
    graph.updateNode(modal.id, {
      interactiveProps: { module: createModalModuleInstance({ contentChildName: '' }) }
    })
    const ir = collectTree(graph, pageId)
    const element = findElement(ir.children, modal.id)
    expect(element.module?.contentSlots).toEqual([])
    expect(moduleContentNodes(element)).toEqual([])
    expect(ir.warnings.some((warning) => warning.code === 'module-content-child-unassigned')).toBe(
      true
    )
  })
  test('relocates only the mapped root while preserving descendants and original canvas geometry', () => {
    const { graph, pageId, modal, modalBody } = compositionGraph()
    graph.updateNode(modalBody.id, { x: 80, y: 60 })
    const element = findElement(collectTree(graph, pageId).children, modal.id)
    const body = moduleContentNodes(element)?.[0].nodes[0]
    expect(body?.kind).toBe('element')
    if (body?.kind !== 'element') throw new Error('Missing mapped body')
    expect(body.className.split(' ')).toContain('relative')
    expect(body.className.split(' ')).not.toContain('absolute')
    expect(graph.getNode(modalBody.id)).toMatchObject({ x: 80, y: 60 })
  })
  test('outer forms do not validate omitted module children or nested form-owned fields', () => {
    const { graph, pageId, modal } = compositionGraph()
    const outer = graph.createNode('FORM', pageId)
    graph.reparentNode(modal.id, outer.id)
    graph.createNode('INPUT', modal.id, {
      name: 'Unassigned required field',
      bindings: { value: { kind: 'docState', docStateName: 'modalEmail' } },
      interactiveProps: { validation: { required: true } }
    })
    const ir = collectTree(graph, pageId)
    expect(findElement(ir.children, outer.id).formValidationKeys ?? []).toEqual([])
  })
  test('marks projected fields when an outer form needs mounted-only validation', () => {
    const { graph, pageId, modal } = compositionGraph()
    const outer = graph.createNode('FORM', pageId)
    graph.reparentNode(modal.id, outer.id)
    graph.updateNode(modal.id, {
      interactiveProps: { module: createModalModuleInstance({ contentChildName: 'Mapped field' }) }
    })
    const field = graph.createNode('INPUT', modal.id, {
      name: 'Mapped field',
      bindings: { value: { kind: 'docState', docStateName: 'modalEmail' } },
      interactiveProps: { validation: { required: true } }
    })
    const ir = collectTree(graph, pageId)
    const form = findElement(ir.children, outer.id)
    expect(form.formValidationMountedOnly).toBe(true)
    expect(form.formValidationKeys).toEqual([field.id])
    const module = findElement(form.children, modal.id)
    expect(findElement(module.children, field.id).validationScopeMarker).toBe(true)
    const projection = moduleContentNodes(module)?.[0].nodes[0]
    expect(projection?.kind === 'element' && projection.validationScopeMarker).toBe(true)
  })
  test('preserves names and mappings through .fig export/import and an editor undo', async () => {
    const { graph, pageId, modal, modalBody } = compositionGraph()
    const bytes = await exportFigFile(graph)
    const imported = await parseFigFile(Uint8Array.from(bytes).buffer)
    const importedModal = [...imported.getAllNodes()].find((node) => node.name === modal.name)
    expect(importedModal?.interactiveProps?.module).toEqual(modal.interactiveProps?.module)
    const restored = collectTree(imported, imported.getPages()[0].id)
    expect(restored.warnings.some((warning) => warning.code.startsWith('module-content'))).toBe(
      false
    )
    const editor = createEditor({ graph })
    editor.updateNodeWithUndo(modalBody.id, { name: 'Renamed body' }, 'Rename content layer')
    editor.undo.undo()
    expect(
      collectTree(editor.graph, pageId).warnings.some((warning) =>
        warning.code.startsWith('module-content')
      )
    ).toBe(false)
  })
  for (const target of ['react', 'vue'] as const) {
    test(`${target} emits mapped form/list content while preserving old text fallback`, () => {
      const result = compositionFiles(target)
      expect(result.warnings).toEqual([])
      const path = target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue'
      const source = String(result.files.get(path))
      expect(source).toContain('Save Dialog')
      expect(source).toContain('Save Tab')
      expect(source).toContain('Item:')
      if (target === 'react') {
        expect(source).toContain(' content={<>')
        expect(source).toContain(' panels={{"panel-profile":')
      } else {
        expect(source).toContain('<template #content>')
        expect(source).toContain('<template #panel-profile>')
        for (const [name, content] of result.files) {
          if (!name.endsWith('.vue') || typeof content !== 'string') continue
          const parsed = parse(content, { filename: name })
          expect(parsed.errors).toEqual([])
          compileScript(parsed.descriptor, { id: name })
          const template = parsed.descriptor.template
          if (template)
            expect(
              compileTemplate({ source: template.content, filename: name, id: name }).errors
            ).toEqual([])
        }
      }
    })
  }
})
