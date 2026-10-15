import { describe, expect, test } from 'bun:test'

import { compileTemplate, parse as parseVueSfc } from 'vue/compiler-sfc'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  selectSearchVirtualFixture,
  selectSearchVirtualGraph,
  selectRuntimePropsFixture
} from '#tests/helpers/compiler/components/select/search-virtual'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function singleSelect(props: SceneNode['interactiveProps']) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const node = graph.createNode('SELECT', pageId, {
    interactiveProps: {
      ariaLabel: 'Choose status',
      options: [
        { label: 'Ready', value: 'ready' },
        { label: 'Unavailable', value: 'blocked', disabled: true }
      ],
      ...props
    }
  })
  const ir = () => collectTree(graph, pageId).children[0] as IRElement
  const output = (target: 'react' | 'vue') =>
    compile({ graph, pageIds: [pageId], options: withDefaults({ target, devMode: false }) })
  return { node, ir, output }
}

describe('SELECT search and virtual list compilation', () => {
  test('only explicit opt-in enables enhancement; default and false remain native', () => {
    for (const props of [{}, { showSearch: false, virtual: false }]) {
      const { ir, output } = singleSelect(props)
      expect(ir().selectFeatures).toBeUndefined()
      expect(ir().tag).toBe('select')
      expect(ir().children).toHaveLength(2)
      for (const target of ['react', 'vue'] as const) {
        const compiled = output(target)
        expect(compiled.warnings).toEqual([])
        expect(compiled.files.has('src/lib/open-pencil-select.ts')).toBe(false)
        const source = [...compiled.files.values()].join('\n')
        expect(source).not.toContain('__OpenPencilSelect')
        expect(source).not.toContain('OpEnhancedSelect')
        expect(source).toContain('<select ')
      }
    }
  })

  test.each([
    { showSearch: true, virtual: false },
    { showSearch: false, virtual: true },
    { showSearch: true, virtual: true }
  ])('independent mode flags %j retain original option semantics in IR', (features) => {
    const element = singleSelect({ ...features, value: 'blocked' }).ir()
    expect(element.selectFeatures).toEqual(features)
    expect(element.attrs.defaultValue).toBe('blocked')
    expect(element.attrs).not.toHaveProperty('showSearch')
    expect(element.attrs).not.toHaveProperty('virtual')
    expect(element.children).toHaveLength(2)
    const blocked = element.children[1] as IRElement
    expect(blocked.attrs).toMatchObject({ value: 'blocked', disabled: true })
    expect(blocked.children).toEqual([{ kind: 'text', value: 'Unavailable' }])
  })

  test('10000 dynamic options stay one IR list and preserve binding, events, and validation', () => {
    const { graph, pageId } = selectSearchVirtualGraph()
    const form = collectTree(graph, pageId).children[0] as IRElement
    const cities = form.children[0] as IRElement
    expect(cities.selectFeatures).toEqual({ showSearch: true, virtual: true })
    expect(cities.selectOptionsSource).toBe(true)
    expect(cities.children).toHaveLength(1)
    expect(cities.children[0]).toMatchObject({ kind: 'list', arrayName: 'cityOptions' })
    expect(cities.controlled?.read).toBe('selectedCity')
    expect(cities.events?.onChange).toHaveLength(2)
    const disabled = form.children[4] as IRElement
    expect(disabled.attrs.disabled).toBe(true)
    const clearable = form.children[2] as IRElement
    expect(clearable.validation).toBeDefined()
    expect(form.formValidationKeys).toContain(clearable.validation?.key)
  })

  test.each(['react', 'vue', 'shadcn'] as const)(
    '%s emits one shared runtime and type-checks bound dynamic and uncontrolled static modes',
    (variant) => {
      const target = variant === 'vue' ? 'vue' : 'react'
      const fixture = selectSearchVirtualFixture(target, variant === 'shadcn')
      const files = new Map(fixture.files)
      expect(files.has('src/lib/open-pencil-select.ts')).toBe(true)
      const source = [...files]
        .filter(([path]) => path === 'src/App.tsx' || path.startsWith('src/pages/'))
        .map(([, value]) => value)
        .join('\n')
      expect(source).toContain(target === 'vue' ? 'OpEnhancedSelect' : '__OpenPencilSelect')
      // Enhanced shadcn output must keep the same runtime and data rather than
      // silently reverting to Radix/static SelectItems or dropping empty values.
      expect(source).not.toContain('<SelectItem')
      expect(fixture.warnings).toEqual([])
      if (target === 'vue') {
        const filename = 'src/pages/index.vue'
        const { descriptor } = parseVueSfc(
          typeof files.get(filename) === 'string' ? String(files.get(filename)) : ''
        )
        const template = compileTemplate({
          source: descriptor.template?.content ?? '',
          filename,
          id: 'select-test'
        })
        expect(template.errors).toEqual([])
        expect(template.code).toContain('_resolveComponent("OpEnhancedSelect")')
        expect(template.code).toContain('_createVNode(_component_OpEnhancedSelect')
        expect(template.code).not.toContain('<__opEnhancedSelect')
      }
      typeCheckCompilerFiles(files, target)
    },
    35_000
  )

  test.each(['react', 'vue'] as const)(
    '%s generated-component host type-checks reactive disabled and native name props',
    (target) => {
      typeCheckCompilerFiles(new Map(selectRuntimePropsFixture(target).files), target)
    },
    35_000
  )
})
