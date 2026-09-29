import { expect, test } from 'bun:test'

import { inputControlClassName } from '#compiler/ir/input-control-style'
import { baseParse } from '@vue/compiler-core'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function fixture(interactiveProps: SceneNode['interactiveProps']) {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const input = graph.createNode('INPUT', page.id, { width: 320, height: 44, interactiveProps })
  return { graph, page, input }
}

test('Vue emits an actual component element rather than literal template text', () => {
  const { graph, page } = fixture({ inputType: 'number', showStepper: true })
  const output = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target: 'vue', devMode: false })
  })
  const source = [...output.files]
    .filter(([path]) => path.endsWith('.vue'))
    .map(([, value]) => String(value))
    .join('\n')
  const element = source.split('\n').find((line) => line.includes(':config='))
  expect(element).toBeDefined()
  const parsed = baseParse(element?.trim() ?? '')
  expect(parsed.children).toHaveLength(1)
  expect(parsed.children[0].type).toBe(1)
})

test('unconfigured INPUT stays native and malformed affordances fail closed without echoing values', () => {
  const { graph, page, input } = fixture({ inputType: 'number', value: '2' })
  const native = compile({ graph, pageIds: [page.id], options: withDefaults({ target: 'react' }) })
  expect(native.warnings).toEqual([])
  expect(native.files.has('src/components/_open-pencil-input-control.tsx')).toBe(false)
  for (const interactiveProps of [
    { inputType: 'number', showStepper: 'true', value: 'not-a-secret-fixture' },
    { inputType: 'password', stepperPlacement: 'sides' },
    { inputType: 'text', showPasswordToggle: true }
  ]) {
    graph.updateNode(input.id, { interactiveProps })
    const tree = collectTree(graph, page.id)
    expect((tree.children[0] as IRElement).inputControl).toBeUndefined()
    expect(tree.warnings.some(({ code }) => code.startsWith('input-affordance-'))).toBe(true)
    expect(JSON.stringify(tree.warnings)).not.toContain('not-a-secret-fixture')
  }
})

test('enhanced input styles follow the native field without remapping unsupported controls', () => {
  const { graph, page, input } = fixture({ inputType: 'password', showPasswordToggle: true })
  const classes =
    'w-[320px] focus:bg-blue-500 disabled:opacity-50 placeholder:text-[#123456] sm:focus-visible:ring-2 read-only:opacity-75 bg-[url(https://example.test/focus:icon.svg)]'
  expect(inputControlClassName(classes, input)).toBe(
    'w-[320px] focus-within:bg-blue-500 has-[>input:disabled]:opacity-50 [&>input]:placeholder:text-[#123456] sm:has-[>input:focus-visible]:ring-2 has-[>input:read-only]:opacity-75 bg-[url(https://example.test/focus:icon.svg)]'
  )
  graph.updateNode(input.id, {
    stateOverrides: { focus: { opacity: 0.8 }, disabled: { opacity: 0.4 } }
  })
  for (const target of ['react', 'vue'] as const) {
    const output = compile({ graph, pageIds: [page.id], options: withDefaults({ target }) })
    expect(output.warnings).toEqual([])
    const app = [...output.files]
      .filter(([name]) => name.endsWith(target === 'react' ? '.tsx' : '.vue'))
      .map(([, source]) => source)
      .join('\n')
    expect(app).toContain('focus-within:opacity-80')
    const css = output.files.get('src/index.css') ?? ''
    expect(css).toContain('has-[>input:disabled]:opacity-40')
    expect(css).toContain('[&>input]:placeholder:')
  }
  for (const interactiveProps of [
    { inputType: 'password', showPasswordToggle: false },
    { inputType: 'text', showPasswordToggle: true },
    { inputType: 'password', showPasswordToggle: true, upload: {} }
  ]) {
    graph.updateNode(input.id, { interactiveProps })
    expect(inputControlClassName(classes, input)).toBe(classes)
  }
})

for (const target of ['expo', 'flutter', 'taro', 'wechat-miniprogram', 'uni-app', 'mpx'] as const) {
  test(`${target} explicitly omits enhanced number and password controls`, () => {
    const { graph, page } = fixture({
      inputType: 'number',
      showStepper: true,
      ariaLabel: 'Enhanced quantity'
    })
    graph.createNode('INPUT', page.id, {
      width: 320,
      height: 44,
      interactiveProps: {
        inputType: 'password',
        showPasswordToggle: true,
        ariaLabel: 'Enhanced password'
      }
    })
    const output = compile({ graph, pageIds: [page.id], options: withDefaults({ target }) })
    expect(output.warnings.map(({ code }) => code)).toContain(
      `${target}-input-number-affordance-unsupported`
    )
    expect(output.warnings.map(({ code }) => code)).toContain(
      `${target}-input-password-affordance-unsupported`
    )
    const source = [...output.files.values()].join('\n')
    expect(source).not.toContain('Enhanced quantity')
    expect(source).not.toContain('Enhanced password')
  })
}

test('shadcn imports Input only when a plain field accompanies enhanced controls', () => {
  const { graph, page } = fixture({ inputType: 'number', showStepper: true })
  const output = () =>
    compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target: 'react', uiKit: 'shadcn', devMode: false })
    })
  expect(output().files.has('src/components/ui/input.tsx')).toBe(false)
  graph.createNode('INPUT', page.id, {
    width: 320,
    height: 44,
    interactiveProps: { inputType: 'text', ariaLabel: 'Plain field' }
  })
  const mixed = output()
  expect(mixed.warnings).toEqual([])
  expect(mixed.files.has('src/components/ui/input.tsx')).toBe(true)
  expect(mixed.files.has('src/components/_open-pencil-input-control.tsx')).toBe(true)
  typeCheckCompilerFiles(mixed.files, 'react')
}, 35000)
