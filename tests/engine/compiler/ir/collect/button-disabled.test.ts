import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { emitExpression } from '@open-pencil/lowcode'
import type { BindingExpr } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function buttonGraph(
  binding: BindingExpr = { kind: 'expr', expr: 'atEnd || locked && step >= 0' }
) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.updateNode(pageId, {
    state: [
      { id: 'step-id', name: 'step', type: 'number', defaultValue: 1 },
      {
        id: 'at-end-id',
        name: 'atEnd',
        type: 'boolean',
        defaultValue: false,
        computedExpr: 'step >= 2'
      }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'lock-id', name: 'locked', type: 'boolean', defaultValue: false }]
  })
  const button = graph.createNode('BUTTON', pageId, {
    interactiveProps: { text: 'Next step', type: 'button' },
    bindings: { disabled: binding },
    events: {
      onClick: [
        { id: 'next-step', kind: 'setState', targetStateId: 'step-id', valueExpr: 'step + 1' }
      ]
    }
  })
  return { graph, pageId, button }
}

function disabledExpression(element: IRElement): string | undefined {
  const value = element.attrs.disabled
  return typeof value === 'object' && value.kind === 'exprAttr'
    ? emitExpression(value.ast)
    : undefined
}

test('native BUTTON reads computed page and document state without changing the click action target', () => {
  const { graph, pageId } = buttonGraph()
  const tree = collectTree(graph, pageId)
  const button = tree.children[0] as IRElement
  expect(tree.warnings).toEqual([])
  expect(disabledExpression(button)).toContain('atEnd || locked && step >= 0')
  expect(tree.docStateReads).toEqual(['locked'])
  expect(tree.docStateWrites).toEqual([])
  expect(button.events?.onClick).toEqual([
    expect.objectContaining({ kind: 'setState', stateName: 'step' })
  ])
  expect(tree.states.find((state) => state.name === 'atEnd')?.computed).toBeDefined()
})

test('an authored static disabled lock cannot be removed by a valid false expression', () => {
  const { graph, pageId, button } = buttonGraph({ kind: 'expr', expr: 'step < 0' })
  graph.updateNode(button.id, {
    interactiveProps: { ...button.interactiveProps, disabled: true }
  })
  const tree = collectTree(graph, pageId)
  expect((tree.children[0] as IRElement).attrs.disabled).toBe(true)
  expect(tree.warnings).toEqual([])
})

test.each([
  [{ kind: 'ref', stateId: 'at-end-id' }, 'button-disabled-binding-invalid'],
  [{ kind: 'docState', docStateName: 'locked' }, 'button-disabled-binding-invalid'],
  [{ kind: 'literal', literalValue: false }, 'button-disabled-binding-invalid'],
  [{ kind: 'expr', expr: 'unknownLock' }, 'button-disabled-binding-unknown'],
  [{ kind: 'expr', expr: '$prev' }, 'button-disabled-binding-prev'],
  [{ kind: 'expr', expr: 'step >' }, 'button-disabled-binding-invalid']
] satisfies [BindingExpr, string][])(
  'invalid disabled read %j keeps the actual native button disabled',
  (binding, warningCode) => {
    const { graph, pageId } = buttonGraph(binding)
    const tree = collectTree(graph, pageId)
    expect((tree.children[0] as IRElement).attrs.disabled).toBe(true)
    expect(tree.warnings).toEqual([
      expect.objectContaining({ code: warningCode, message: expect.stringContaining('BUTTON') })
    ])
  }
)

test('disabled expression metadata is read without invoking imported accessors', () => {
  const binding: BindingExpr = { kind: 'expr', expr: 'false' }
  let reads = 0
  Object.defineProperty(binding, 'expr', {
    get() {
      reads++
      return 'false'
    },
    enumerable: true
  })
  const { graph, pageId } = buttonGraph(binding)
  const tree = collectTree(graph, pageId)
  expect(reads).toBe(0)
  expect((tree.children[0] as IRElement).attrs.disabled).toBe(true)
  expect(tree.warnings[0]?.code).toBe('button-disabled-binding-invalid')
})

test('BUTTON disabled binding does not widen the dynamic attributes of other native controls', () => {
  const { graph, pageId, button } = buttonGraph()
  graph.updateNode(button.id, { bindings: {} })
  graph.createNode('INPUT', pageId, {
    bindings: { disabled: { kind: 'expr', expr: 'locked' } }
  })
  const tree = collectTree(graph, pageId)
  expect((tree.children[0] as IRElement).attrs.disabled).toBeUndefined()
  expect((tree.children[1] as IRElement).attrs.disabled).toBeUndefined()
  expect(tree.docStateReads).toEqual([])
})

test.each(['react', 'vue'] as const)(
  '%s emits a reactive disabled attribute with typed computed and document reads',
  (target) => {
    const { graph, pageId } = buttonGraph()
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, router: 'none', devMode: false })
    })
    expect(output.warnings).toEqual([])
    const files = new Map(
      [...output.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    const source = [...files.values()].join('\n')
    if (target === 'react') expect(source).toContain('disabled={!!(atEnd || locked && step >= 0)}')
    else {
      expect(source).toMatch(/:disabled="__opSelectExpr_\d+"/)
      expect(source).toMatch(
        /__vueComputed\(\(\) => !!\(__opState_atEnd_\w+\.value \|\| __opDoc_locked_\w+\.value && __opState_step_\w+\.value >= 0\)\)/
      )
    }
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  },
  35000
)

test.each(['react', 'vue'] as const)(
  '%s normalizes numeric disabled reads to the boolean native attribute type',
  (target) => {
    const { graph, pageId } = buttonGraph({ kind: 'expr', expr: 'step' })
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, router: 'none', devMode: false })
    })
    expect(output.warnings).toEqual([])
    const files = new Map(
      [...output.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  },
  35000
)

test('Vue disabled script bindings escape closing script literals before entering an SFC', () => {
  const { graph, pageId } = buttonGraph({
    kind: 'expr',
    expr: 'step + "</script>" === "</script>"'
  })
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target: 'vue', router: 'none', devMode: false })
  })
  expect(output.warnings).toEqual([])
  const files = new Map(
    [...output.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
  const page = files.get('src/pages/index.vue') ?? ''
  expect(page.match(/<\/script>/g)).toHaveLength(1)
  expect(page).toContain('<\\/script>')
  expect(() => typeCheckCompilerFiles(files, 'vue')).not.toThrow()
}, 35000)
