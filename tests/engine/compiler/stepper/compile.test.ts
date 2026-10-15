import { expect, test } from 'bun:test'

import { buildComponentRegistry } from '#compiler/ir/collect/components'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { createStepperModuleInstance, moduleValueFields } from '@open-pencil/core/plugins'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

import { stepperGraph } from './helpers'

function collected() {
  const fixture = stepperGraph(),
    tree = collectTree(fixture.graph, fixture.page.id)
  const form = tree.children[0] as IRElement
  const main = form.children.find(
    (child) => child.kind === 'element' && child.sourceId === fixture.main.id
  ) as IRElement
  return { ...fixture, tree, formIR: form, mainIR: main }
}

test('exact Stepper binds numeric business state and joins FORM reset without submitting a field', () => {
  const { tree, mainIR, formIR, main, sibling } = collected()
  expect(tree.warnings).toEqual([])
  expect(mainIR.module?.stepper).toEqual({
    currentIndex: { kind: 'ident', name: 'step' },
    write: { kind: 'state', name: 'step', targetType: 'number' }
  })
  expect(tree.docStateReads).toContain('docStep')
  expect(tree.docStateWrites).toContain('docStep')
  expect(moduleValueFields(main)).toEqual([])
  expect(mainIR.module?.valueFields).toBeUndefined()
  expect(mainIR.controlled).toBeUndefined()
  expect(mainIR.validation).toBeUndefined()
  expect(formIR.formResetFields).toEqual([
    {
      write: { kind: 'state', name: 'step', targetType: 'number' },
      defaultValue: 0,
      sourceIds: [main.id, sibling.id]
    },
    expect.objectContaining({
      write: { kind: 'docState', name: 'docStep', targetType: 'number' },
      defaultValue: 1
    })
  ])
})

for (const target of ['react', 'vue'] as const)
  test(`${target} emits typed Stepper binding, ordinary change event details and FORM reset`, () => {
    const { graph, page } = stepperGraph()
    const result = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target, router: 'none', devMode: false })
    })
    expect(result.warnings).toEqual([])
    const files = new Map(
      [...result.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    const source = [...files.values()].join('\n')
    expect(source).toContain(
      target === 'react' ? 'currentIndexBound' : ':current-index-bound="true"'
    )
    expect(source).toContain(target === 'react' ? 'onStepsChange=' : '@stepschange=')
    expect(source).toContain('.detail.previousIndex')
    expect(source).toContain('__openPencilFormResetAccepted')
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  }, 35000)

for (const kind of [
  'string',
  'computed',
  'computed-invalid',
  'missing',
  'expression',
  'duplicate-name',
  'duplicate-id',
  'doc-duplicate'
] as const)
  test(`Stepper rejects ${kind} binding and retains an invalid read sentinel`, () => {
    const { graph, page, main } = stepperGraph()
    if (kind === 'string')
      graph.updateNode(page.id, {
        state: page.state?.map((state) =>
          state.id === 'step' ? { ...state, type: 'string', defaultValue: '0' } : state
        )
      })
    if (kind === 'computed' || kind === 'computed-invalid')
      graph.updateNode(page.id, {
        state: page.state?.map((state) =>
          state.id === 'step'
            ? { ...state, computedExpr: kind === 'computed' ? 'changed + 1' : 'missing + 1' }
            : state
        )
      })
    if (kind === 'missing')
      graph.updateNode(main.id, { bindings: { currentIndex: { kind: 'ref', stateId: 'missing' } } })
    if (kind === 'expression')
      graph.updateNode(main.id, { bindings: { currentIndex: { kind: 'expr', expr: 'step' } } })
    if (kind === 'duplicate-name' || kind === 'duplicate-id')
      graph.updateNode(page.id, {
        state: [
          ...(page.state ?? []),
          {
            id: kind === 'duplicate-id' ? 'step' : 'duplicate',
            name: kind === 'duplicate-name' ? 'step' : 'duplicate',
            type: 'number',
            defaultValue: 1
          }
        ]
      })
    if (kind === 'doc-duplicate') {
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [
          { id: 'one', name: 'docStep', type: 'number', defaultValue: 0 },
          { id: 'two', name: 'docStep', type: 'number', defaultValue: 1 }
        ]
      })
      graph.updateNode(main.id, {
        bindings: { currentIndex: { kind: 'docState', docStateName: 'docStep' } }
      })
    }
    const tree = collectTree(graph, page.id),
      form = tree.children[0] as IRElement
    const node = form.children.find(
      (child) => child.kind === 'element' && child.sourceId === main.id
    ) as IRElement
    expect(node.module?.stepper?.currentIndex).toEqual({ kind: 'ident', name: 'undefined' })
    expect(node.module?.stepper?.write).toBeUndefined()
    expect(
      tree.warnings.some(
        (warning) => warning.nodeId === main.id && warning.code === 'stepper-binding-invalid'
      )
    ).toBe(true)
  })

test.each([null, 0])(
  'Stepper rejects malformed document computedExpr %j before normalization can grant a write',
  (computedExpr) => {
    const { graph, page, doc } = stepperGraph()
    const declaration = graph.getNode(graph.rootId)?.lowcodeDocumentState?.[0]
    if (!declaration) throw new Error('Document state fixture is missing')
    Object.defineProperty(declaration, 'computedExpr', {
      value: computedExpr,
      enumerable: true,
      writable: true
    })
    const tree = collectTree(graph, page.id)
    const form = tree.children[0] as IRElement
    const node = form.children.find(
      (child) => child.kind === 'element' && child.sourceId === doc.id
    ) as IRElement
    expect(node.module?.stepper).toEqual({
      currentIndex: { kind: 'ident', name: 'undefined' }
    })
    expect(tree.docStateReads).not.toContain('docStep')
    expect(tree.docStateWrites).not.toContain('docStep')
    expect(form.formResetFields?.some((field) => field.sourceIds.includes(doc.id))).toBe(false)
    expect(tree.warnings).toContainEqual(
      expect.objectContaining({ nodeId: doc.id, code: 'stepper-binding-invalid' })
    )
  }
)

test('unknown Stepper version and generic look-alike FRAME never receive step writes', () => {
  for (const reviewed of [true, false]) {
    const { graph, page, main } = stepperGraph()
    graph.updateNode(main.id, {
      interactiveProps: reviewed
        ? { module: { ...createStepperModuleInstance(), configVersion: 99 } }
        : {}
    })
    const tree = collectTree(graph, page.id),
      form = tree.children[0] as IRElement
    const node = form.children.find(
      (child) => child.kind === 'element' && child.sourceId === main.id
    ) as IRElement
    expect(node.module?.stepper).toBeUndefined()
    expect(form.formResetFields?.some((field) => field.sourceIds.includes(main.id))).toBe(false)
  }
})

test('Stepper FORM reset stops at nested FORMs', () => {
  const { graph, page, main, form } = stepperGraph()
  const nested = graph.createNode('FORM', form.id, { name: 'Nested form' })
  graph.reparentNode(main.id, nested.id)
  const tree = collectTree(graph, page.id),
    outer = tree.children[0] as IRElement
  expect(outer.formResetFields?.some((field) => field.sourceIds.includes(main.id))).toBe(false)
  const inner = outer.children.find(
    (child) => child.kind === 'element' && child.sourceId === nested.id
  ) as IRElement
  expect(inner.formResetFields?.some((field) => field.sourceIds.includes(main.id))).toBe(true)
})

test('a clean component Stepper joins its enclosing FORM reset without a native input', () => {
  const { graph, page, form, doc } = stepperGraph()
  const library = graph.addPage('Stepper library')
  const master = graph.createNode('COMPONENT', library.id, { name: 'Reusable stepper' })
  graph.reparentNode(doc.id, master.id)
  const instance = graph.createInstance(master.id, form.id)
  if (!instance) throw new Error('Expected an instance')
  const tree = collectTree(graph, page.id, buildComponentRegistry(graph))
  const owner = tree.children[0] as IRElement
  expect(owner.formResetFields?.map((field) => field.write.name)).toContain('docStep')
  const rendered = owner.children.find(
    (child) => child.kind === 'element' && child.sourceId === instance.id
  )
  expect(rendered?.kind).toBe('element')
  expect(tree.warnings).toEqual([])
})

test('a Stepper in an unexpanded imported component diagnoses the unavailable FORM reset owner', () => {
  const { graph, page, form, doc } = stepperGraph()
  const library = graph.addPage('Imported Stepper library')
  const master = graph.createNode('COMPONENT', library.id, { name: 'Imported stepper' })
  graph.reparentNode(doc.id, master.id)
  const instance = graph.createNode('INSTANCE', form.id, { componentId: master.id })
  const tree = collectTree(graph, page.id, buildComponentRegistry(graph))
  expect(tree.warnings).toContainEqual(
    expect.objectContaining({ code: 'form-reset-component-unexpanded', nodeId: instance.id })
  )
})

for (const type of ['COMPONENT', 'COMPONENT_SET', 'INSTANCE'] as const)
  test(`Stepper inside ${type} rejects containing page state while preserving document state`, () => {
    const { graph, page, form, main } = stepperGraph()
    const boundary = graph.createNode(type, form.id, { name: 'Reusable boundary' })
    graph.reparentNode(main.id, boundary.id)
    const tree = collectTree(graph, page.id)
    const owner = tree.children[0] as IRElement
    const body = owner.children.find(
      (child) => child.kind === 'element' && child.sourceId === boundary.id
    ) as IRElement
    const child = body.children.find(
      (node) => node.kind === 'element' && node.sourceId === main.id
    ) as IRElement
    expect(child.module?.stepper?.currentIndex).toEqual({ kind: 'ident', name: 'undefined' })
    expect(child.module?.stepper?.write).toBeUndefined()
    expect(
      tree.warnings.some(
        (warning) => warning.nodeId === main.id && warning.code === 'stepper-binding-invalid'
      )
    ).toBe(true)
    graph.updateNode(main.id, {
      bindings: { currentIndex: { kind: 'docState', docStateName: 'docStep' } }
    })
    const documentTree = collectTree(graph, page.id),
      documentOwner = documentTree.children[0] as IRElement
    const documentBody = documentOwner.children.find(
      (node) => node.kind === 'element' && node.sourceId === boundary.id
    ) as IRElement
    const documentChild = documentBody.children.find(
      (node) => node.kind === 'element' && node.sourceId === main.id
    ) as IRElement
    expect(documentChild.module?.stepper?.write).toEqual({
      kind: 'docState',
      name: 'docStep',
      targetType: 'number'
    })
    expect(
      documentTree.warnings.some(
        (warning) => warning.nodeId === main.id && warning.code === 'stepper-binding-invalid'
      )
    ).toBe(false)
  })
