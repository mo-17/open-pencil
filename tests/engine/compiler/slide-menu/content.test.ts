import { beforeAll, describe, expect, test } from 'bun:test'

import { trustedNativeSlideMenuTrigger } from '#compiler/adapters/native-shared'
import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'
import { moduleContentNodes } from '#compiler/modules/content-slots'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { createSlideMenuModuleInstance, resolveSlideMenuModule } from '@open-pencil/core/plugins'

import { compositionGraph } from '#tests/helpers/compiler/components/composition'

function drawerFixture() {
  const fixture = compositionGraph()
  fixture.graph.updateNode(fixture.modal.id, {
    interactiveProps: {
      module: createSlideMenuModuleInstance({
        direction: 'right',
        triggerLabel: 'Edit drawer',
        contentChildName: fixture.modalBody.name
      })
    }
  })
  fixture.graph.updateNode(fixture.modalBody.id, { x: 90, y: 70 })
  fixture.graph.createNode('TEXT', fixture.modal.id, { text: 'UNMAPPED_DRAWER_CHILD' })
  return fixture
}

function drawerIR(fixture: ReturnType<typeof drawerFixture>): IRElement {
  const node = collectTree(fixture.graph, fixture.pageId).children.find(
    (entry) => entry.kind === 'element' && entry.sourceId === fixture.modal.id
  )
  if (node?.kind !== 'element') throw new Error('Drawer IR unavailable')
  return node
}

describe('Slide Menu editable child content', () => {
  beforeAll(initCodec)

  test('preserves legacy v1/v2 triggers while accepting only a bounded optional mapping', () => {
    const instance = createSlideMenuModuleInstance()
    expect(Object.hasOwn(instance.config, 'contentChildName')).toBe(false)
    const legacy = structuredClone(instance)
    legacy.configVersion = 1
    Reflect.deleteProperty(legacy.config, 'showTriggerIcon')
    Reflect.deleteProperty(legacy.config, 'showTriggerLabel')
    expect(resolveSlideMenuModule(legacy)).toMatchObject({
      ok: true,
      instance: { configVersion: 2 }
    })
    expect(() => createSlideMenuModuleInstance({ contentChildName: 'x'.repeat(121) })).toThrow()
    expect(() => createSlideMenuModuleInstance({ contentChildName: 12 })).toThrow()
    expect(() =>
      createSlideMenuModuleInstance({ contentChildName: 'Body', html: '<b />' })
    ).toThrow()
    expect(
      resolveSlideMenuModule({ ...legacy, config: { ...legacy.config, contentChildName: 'Body' } })
    ).toMatchObject({ ok: false })
    expect(
      resolveSlideMenuModule(createSlideMenuModuleInstance({ contentChildName: '' }))
    ).toMatchObject({ ok: true, config: { contentChildName: '' } })
  })

  for (const target of ['react', 'vue'] as const) {
    test(`${target} emits a mapped FORM with bindings, submit, validation and independent placement`, () => {
      const fixture = drawerFixture()
      const node = drawerIR(fixture)
      expect(node.module?.contentSlots).toEqual([
        { name: 'content', sourceId: fixture.modalBody.id }
      ])
      const body = moduleContentNodes(node)?.[0].nodes[0]
      expect(body?.kind === 'element' && body.tag).toBe('form')
      expect(body?.kind === 'element' && body.className.split(' ')).toContain('relative')
      expect(fixture.modalBody).toMatchObject({ x: 90, y: 70, visible: true })
      const output = compile({
        graph: fixture.graph,
        pageIds: [fixture.pageId],
        options: withDefaults({ target, devMode: false })
      })
      const source = String(
        output.files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
      )
      expect(source).toContain('Save Dialog')
      expect(source).toContain('Dialog email')
      expect(source).toContain('Dialog is required')
      expect(source).toContain(target === 'react' ? ' content={<>' : '<template #content>')
      expect(source).not.toContain('UNMAPPED_DRAWER_CHILD')
      expect(
        output.warnings.filter((warning) => warning.code !== 'module-content-child-unassigned')
      ).toEqual([])
      if (target === 'vue') {
        for (const [name, content] of output.files) {
          if (!name.endsWith('.vue') || typeof content !== 'string') continue
          const parsed = parse(content, { filename: name })
          expect(parsed.errors).toEqual([])
          compileScript(parsed.descriptor, { id: name })
          if (parsed.descriptor.template)
            expect(
              compileTemplate({
                source: parsed.descriptor.template.content,
                filename: name,
                id: name
              }).errors
            ).toEqual([])
        }
      } else {
        const parser = new Bun.Transpiler({ loader: 'tsx' })
        for (const [name, content] of output.files) {
          if (name.endsWith('.tsx') && typeof content === 'string')
            expect(() => parser.transformSync(content)).not.toThrow()
        }
      }
    })

    test.each(['missing', 'duplicate', 'hidden-duplicate', 'hidden', 'nested'] as const)(
      `${target} fails closed for a %s mapping`,
      (failure) => {
        const fixture = drawerFixture()
        if (failure === 'missing')
          fixture.graph.updateNode(fixture.modalBody.id, { name: 'Changed' })
        if (failure === 'hidden') fixture.graph.updateNode(fixture.modalBody.id, { visible: false })
        if (failure === 'duplicate' || failure === 'hidden-duplicate')
          fixture.graph.createNode('FRAME', fixture.modal.id, {
            name: fixture.modalBody.name,
            visible: failure === 'duplicate'
          })
        if (failure === 'nested') {
          const wrapper = fixture.graph.createNode('FRAME', fixture.modal.id)
          fixture.graph.reparentNode(fixture.modalBody.id, wrapper.id)
        }
        expect(drawerIR(fixture).module?.contentSlots).toEqual([
          { name: 'content', sourceId: null }
        ])
        const output = compile({
          graph: fixture.graph,
          pageIds: [fixture.pageId],
          options: withDefaults({ target, devMode: false })
        })
        const source = String(
          output.files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
        )
        expect(source).not.toContain('Save Dialog')
        expect(source).not.toContain('UNMAPPED_DRAWER_CHILD')
        expect(
          output.warnings.some((warning) => warning.code === 'module-content-child-invalid')
        ).toBe(true)
      }
    )
  }

  test('only exact reviewed identity gains slot routing and explicit empty mode hides unassigned children', () => {
    const fixture = drawerFixture()
    fixture.graph.updateNode(fixture.modal.id, {
      interactiveProps: { module: createSlideMenuModuleInstance({ contentChildName: '' }) }
    })
    expect(drawerIR(fixture).module?.contentSlots).toEqual([])
    fixture.graph.updateNode(fixture.modal.id, {
      interactiveProps: { module: createSlideMenuModuleInstance() }
    })
    expect(drawerIR(fixture).module?.contentSlots).toBeUndefined()
    const module = createSlideMenuModuleInstance({ contentChildName: fixture.modalBody.name })
    fixture.graph.updateNode(fixture.modal.id, {
      interactiveProps: { module: { ...module, pluginId: 'unknown.drawer' } }
    })
    expect(drawerIR(fixture).module).toBeUndefined()
    expect(trustedNativeSlideMenuTrigger(drawerIR(fixture))).toBeUndefined()
    expect(fixture.modal.interactiveProps?.module).toEqual({
      ...module,
      pluginId: 'unknown.drawer'
    })
  })

  test('keeps the portaled body out of an outer FORM reset and validation scope', () => {
    const fixture = drawerFixture()
    const outer = fixture.graph.createNode('FORM', fixture.pageId)
    fixture.graph.reparentNode(fixture.modal.id, outer.id)
    const input = fixture.graph.createNode('INPUT', fixture.modalBody.id, {
      bindings: { value: { kind: 'docState', docStateName: 'status' } },
      interactiveProps: { validation: { required: true } }
    })
    const node = collectTree(fixture.graph, fixture.pageId).children.find(
      (entry): entry is IRElement => entry.kind === 'element' && entry.sourceId === outer.id
    )
    expect(node?.formResetFields ?? []).toEqual([])
    expect(node?.formValidationKeys ?? []).toEqual([])
    expect(node?.formValidationKeys).not.toContain(input.id)
  })

  test('native export emits a static trigger, an omission diagnostic, and no mapped FORM body', () => {
    const fixture = drawerFixture()
    expect(trustedNativeSlideMenuTrigger(drawerIR(fixture))).toMatchObject({ label: 'Edit drawer' })
    for (const target of ['expo', 'flutter'] as const) {
      const output = compile({
        graph: fixture.graph,
        pageIds: [fixture.pageId],
        options: withDefaults({ target, devMode: false })
      })
      const sources = [...output.files]
        .filter(([name]) => name.endsWith('.tsx') || name.endsWith('.dart'))
        .map(([, source]) => String(source))
        .join('\n')
      expect(sources).toContain('Edit drawer')
      expect(sources).not.toContain('Dialog email')
      expect(sources).not.toContain('UNMAPPED_DRAWER_CHILD')
      expect(
        output.warnings.some(
          (warning) => warning.nodeId === fixture.modal.id && warning.code.includes('unsupported')
        )
      ).toBe(true)
    }
  })

  test('preserves explicit mapping and authored body through .fig readback', async () => {
    const fixture = drawerFixture()
    const bytes = await exportFigFile(fixture.graph)
    const graph = await parseFigFile(Uint8Array.from(bytes).buffer)
    const node = [...graph.getAllNodes()].find((entry) => entry.name === fixture.modal.name)
    expect(node?.interactiveProps?.module).toEqual(fixture.modal.interactiveProps?.module)
    const tree = collectTree(graph, graph.getPages()[0].id)
    expect(tree.warnings.some((warning) => warning.code === 'module-content-child-invalid')).toBe(
      false
    )
  })
})
