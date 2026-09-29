import { describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'
import { moduleContentNodes } from '#compiler/modules/content-slots'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createModalModuleFrameOverrides,
  createModalModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

function fixture(type: 'FRAME' | 'FORM' | 'TEXT' = 'FRAME') {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const modal = graph.createNode(
    'FRAME',
    pageId,
    createModalModuleFrameOverrides({
      triggerLabel: 'Open custom content',
      content: 'LEGACY_TEXT_BODY',
      contentChildName: 'Modal body'
    })
  )
  const body = graph.createNode(type, modal.id, {
    name: 'Modal body',
    width: 320,
    height: 120,
    x: 80,
    y: 60,
    ...(type === 'TEXT'
      ? { text: 'CUSTOM_BODY_MARKER' }
      : { layoutMode: 'VERTICAL', itemSpacing: 8 })
  })
  if (type !== 'TEXT') {
    graph.createNode('TEXT', body.id, { text: 'CUSTOM_BODY_MARKER', width: 240, height: 30 })
    graph.createNode('INPUT', body.id, {
      width: 280,
      height: 44,
      interactiveProps: { placeholder: 'Editable dialog field' }
    })
  }
  const spare = graph.createNode('TEXT', modal.id, {
    name: 'Unmapped layer',
    text: 'UNASSIGNED_MARKER'
  })
  return { graph, pageId, modal, body, spare }
}

function modalElement(input: ReturnType<typeof fixture>): IRElement {
  const ir = collectTree(input.graph, input.pageId)
  const node = ir.children.find(
    (entry) => entry.kind === 'element' && entry.sourceId === input.modal.id
  )
  if (node?.kind !== 'element') throw new Error('Modal IR was not generated')
  return node
}

function emitted(input: ReturnType<typeof fixture>, target: 'react' | 'vue') {
  const output = compile({
    graph: input.graph,
    pageIds: [input.pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  const source = output.files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
  if (typeof source !== 'string') throw new Error('Missing generated page')
  return { ...output, source }
}

describe('Modal custom direct-child content', () => {
  for (const target of ['react', 'vue'] as const) {
    test.each(['FRAME', 'FORM', 'TEXT'] as const)(
      `${target} emits a %s body independently from the trigger and unassigned children`,
      (type) => {
        const input = fixture(type)
        const module = modalElement(input)
        expect(module.module?.contentSlots).toEqual([{ name: 'content', sourceId: input.body.id }])
        const projected = moduleContentNodes(module)?.[0].nodes[0]
        if (projected?.kind !== 'element') throw new Error('Missing projected Modal body')
        expect(projected.tag).toBe({ FRAME: 'div', FORM: 'form', TEXT: 'p' }[type])
        expect(projected.className.split(' ')).toContain('relative')
        expect(projected.className.split(' ')).not.toContain('absolute')
        expect(input.graph.getNode(input.body.id)).toMatchObject({ x: 80, y: 60, visible: true })

        const { source, warnings } = emitted(input, target)
        expect(source).toContain('CUSTOM_BODY_MARKER')
        expect(source).not.toContain('UNASSIGNED_MARKER')
        expect(source).toContain(target === 'react' ? ' content={<>' : '<template #content>')
        if (type !== 'TEXT') expect(source).toContain('Editable dialog field')
        if (type === 'FORM') expect(source).toContain('<form ')
        expect(
          warnings.filter((warning) => warning.code === 'module-content-child-invalid')
        ).toEqual([])
      }
    )

    test.each(['rename', 'nested-only', 'duplicate', 'hidden-duplicate', 'hidden'] as const)(
      `${target} keeps an invalid %s mapping empty without leaking other children into the trigger`,
      (failure) => {
        const input = fixture()
        if (failure === 'rename') input.graph.updateNode(input.body.id, { name: 'Renamed body' })
        if (failure === 'nested-only') {
          const wrapper = input.graph.createNode('FRAME', input.modal.id, {
            name: 'Nested wrapper'
          })
          input.graph.reparentNode(input.body.id, wrapper.id)
        }
        if (failure === 'duplicate' || failure === 'hidden-duplicate') {
          input.graph.createNode('FRAME', input.modal.id, {
            name: input.body.name,
            visible: failure !== 'hidden-duplicate'
          })
        }
        if (failure === 'hidden') input.graph.updateNode(input.body.id, { visible: false })
        expect(modalElement(input).module?.contentSlots).toEqual([
          { name: 'content', sourceId: null }
        ])
        const { source, warnings } = emitted(input, target)
        expect(warnings.some((warning) => warning.code === 'module-content-child-invalid')).toBe(
          true
        )
        expect(source).not.toContain('CUSTOM_BODY_MARKER')
        expect(source).not.toContain('UNASSIGNED_MARKER')
        if (target === 'react') expect(source).toContain(' content={<></>}')
        else expect(source).toMatch(/<template #content>\s*<\/template>/)
      }
    )

    test(`${target} distinguishes explicit text mode from legacy authored trigger children`, () => {
      const input = fixture()
      const instance = createModalModuleInstance({
        content: 'LEGACY_TEXT_BODY',
        contentChildName: ''
      })
      input.graph.updateNode(input.modal.id, { interactiveProps: { module: instance } })
      expect(modalElement(input).module?.contentSlots).toEqual([])
      const textMode = emitted(input, target).source
      expect(textMode).toContain('LEGACY_TEXT_BODY')
      expect(textMode).not.toContain('CUSTOM_BODY_MARKER')
      expect(textMode).not.toContain('UNASSIGNED_MARKER')

      const legacy = structuredClone(instance)
      Reflect.deleteProperty(legacy.config, 'contentChildName')
      input.graph.updateNode(input.modal.id, { interactiveProps: { module: legacy } })
      expect(modalElement(input).module?.contentSlots).toBeUndefined()
      const legacySource = emitted(input, target).source
      expect(legacySource).toContain('CUSTOM_BODY_MARKER')
      expect(legacySource).toContain('UNASSIGNED_MARKER')
    })
  }
})
