import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

function project(
  props: SceneNode['interactiveProps'],
  target: 'react' | 'vue' = 'react',
  shadcn = false
) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [
      { id: 'choice', name: 'choice', type: 'string', defaultValue: 'b' },
      {
        id: 'choices',
        name: 'choices',
        type: 'array',
        defaultValue: [
          { id: '', label: 'Any status' },
          { id: 'b', label: 'Ready' }
        ]
      }
    ]
  })
  const node = graph.createNode('SELECT', pageId, {
    interactiveProps: {
      ariaLabel: 'Status',
      options: [{ label: 'Ready', value: 'b' }],
      ...props
    }
  })
  const output = () =>
    compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, ...(shadcn ? { uiKit: 'shadcn' } : {}), devMode: false })
    })
  const ir = () => collectTree(graph, pageId).children[0] as IRElement
  return { graph, node, ir, output }
}

function source(output: ReturnType<ReturnType<typeof project>['output']>) {
  return [...output.files]
    .filter(([path]) => path === 'src/App.tsx' || path.startsWith('src/pages/'))
    .map(([, value]) => value)
    .join('\n')
}

describe('SELECT placeholder and clear contracts', () => {
  test('legacy and empty placeholder preserve existing options and default selection', () => {
    for (const placeholder of [undefined, '']) {
      const { ir } = project(placeholder === undefined ? {} : { placeholder })
      expect(ir().attrs).not.toHaveProperty('defaultValue')
      expect(ir().children).toHaveLength(1)
    }
  })

  test('placeholder starts empty and is disabled until clearing is enabled', () => {
    const { ir } = project({ placeholder: '请选择状态' })
    expect(ir().attrs.defaultValue).toBe('')
    expect(ir().children).toHaveLength(2)
    expect((ir().children[0] as IRElement).attrs).toMatchObject({ value: '', disabled: true })
    expect((ir().children[0] as IRElement).children).toEqual([
      { kind: 'text', value: '请选择状态' }
    ])
    const cleared = project({ allowClear: true }).ir()
    expect(cleared.attrs.defaultValue).toBe('')
    expect((cleared.children[0] as IRElement).attrs.disabled).not.toBe(true)
    expect((cleared.children[0] as IRElement).children).toEqual([
      { kind: 'text', value: 'Select an option' }
    ])
  })

  test('author empty option, default, and controlled binding retain priority', () => {
    const { graph, node, ir } = project({
      placeholder: 'Pick status',
      allowClear: true,
      value: 'b',
      options: [
        { label: 'Any status', value: '', disabled: true },
        { label: 'Ready', value: 'b' }
      ]
    })
    expect(ir().children).toHaveLength(2)
    expect((ir().children[0] as IRElement).children).toEqual([
      { kind: 'text', value: 'Any status' }
    ])
    expect((ir().children[0] as IRElement).attrs.disabled).toBe(true)
    expect(ir().attrs.defaultValue).toBe('b')
    graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'choice' } } })
    expect(ir().attrs).not.toHaveProperty('defaultValue')
    expect(ir().controlled?.read).toBe('choice')
  })

  test('Vue applies matching literal defaults but keeps unmatched legacy defaults native', () => {
    for (const value of ['', 'missing']) {
      const generated = source(project({ value }, 'vue').output())
      expect(generated).not.toContain('__opSelectDefault_')
    }
    const generated = source(project({ value: 'b' }, 'vue').output())
    expect(generated).toMatch(/const __opSelectDefault_\d+ = "b"/)
    expect(generated).toContain(':value="__opSelectDefault_')
  })

  test('React validation keeps selector classes as JavaScript strings instead of HTML entities', () => {
    const { graph, node, output } = project({
      placeholder: 'Pick status',
      validation: { required: true }
    })
    graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'choice' } } })
    const generated = source(output())
    const classes = generated.match(/className=\{("(?:[^"\\]|\\.)*") \+ \(__fieldErrors/)
    expect(classes).not.toBeNull()
    if (!classes) throw new Error('Expected the generated validated class expression')
    expect(JSON.parse(classes[1])).toContain(
      '[&:has(>option[data-op-select-placeholder]:checked)]'
    )
    expect(JSON.parse(classes[1])).not.toContain('&amp;')
  })

  test.each(['react', 'vue'] as const)(
    '%s keeps a dynamic business empty value instead of duplicating it',
    (target) => {
      const { output } = project(
        {
          placeholder: 'Pick status',
          allowClear: true,
          optionsSource: {
            kind: 'ref',
            stateId: 'choices',
            itemName: 'choiceOption',
            valueExpr: 'choiceOption.id',
            labelExpr: 'choiceOption.label'
          }
        },
        target
      )
      const generated = source(output())
      expect(generated).toContain('.some(')
      expect(generated).toContain('choiceOption')
      expect(generated).toContain('Pick status')
      expect(generated).not.toContain('SelectItem')
      if (target === 'react') expect(generated).toContain('choiceOption.id) === ""')
      else expect(generated).toContain(':value="__opSelectDefault_')
    }
  )

  test('shadcn dynamic and empty-value contracts fall back to native without changing business values', () => {
    for (const props of [
      { placeholder: 'Pick status' },
      {
        optionsSource: {
          kind: 'ref',
          stateId: 'choices',
          valueExpr: 'item.id',
          labelExpr: 'item.label'
        }
      },
      { optionsSource: { kind: 'ref', stateId: 'missing' } }
    ]) {
      const output = project(props, 'react', true).output()
      expect(source(output)).toContain('<select ')
      expect(source(output)).not.toContain('<SelectItem')
      expect(output.warnings.some(({ code }) => code === 'ui-kit-native-control-fallback')).toBe(
        true
      )
    }
  })

  test.each(['react', 'vue'] as const)(
    '%s uses safe authored text and placeholder colors only on synthetic placeholders',
    (target) => {
      const generated = source(
        project(
          { placeholder: 'Pick status', textColor: '#123456', placeholderColor: '#789abc' },
          target
        ).output()
      )
      expect(generated).toContain('text-[#123456]')
      expect(generated).toContain('text-[#789ABC]')
      expect(generated).toContain('data-op-select-placeholder')
      const invalid = source(
        project({ textColor: 'red;display:none', placeholderColor: 'url(secret)' }, target).output()
      )
      expect(invalid).not.toContain('red;display:none')
      expect(invalid).not.toContain('url(secret)')
    }
  )
})
