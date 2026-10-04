import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement, IRNode } from '@open-pencil/compiler/ir/types'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { moduleValueFields, resolveStepperModule } from '@open-pencil/core/plugins'
import { parseExpression } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { createComponentTemplate } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

function elements(nodes: readonly IRNode[]): IRElement[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'conditional') return elements([node.consequent])
    if (node.kind !== 'element') return []
    return [node, ...elements(node.children)]
  })
}

function assertStageForms(graph: SceneGraph, pageId: string) {
  const nodes = [...graph.getAllNodes()]
  const stepper = nodes.find((node) => resolveStepperModule(node.interactiveProps?.module)?.ok)
  if (!stepper) throw new Error('Expected reviewed Stepper')
  const resolved = resolveStepperModule(stepper.interactiveProps?.module)
  expect(resolved?.ok && resolved.config).toMatchObject({
    currentIndex: 0,
    allowStepClick: false,
    items: expect.arrayContaining([expect.objectContaining({ disabled: false })])
  })
  expect(moduleValueFields(stepper)).toEqual([])
  expect(stepper.events).toBeUndefined()
  const stepBinding = stepper.bindings?.currentIndex
  if (stepBinding?.kind !== 'ref' || !stepBinding.stateId)
    throw new Error('Expected numeric page binding')
  expect(graph.getNode(pageId)?.state).toEqual([
    expect.objectContaining({ id: stepBinding.stateId, type: 'number', defaultValue: 0 })
  ])
  const forms = nodes.filter((node) => node.type === 'FORM')
  expect(forms).toHaveLength(2)
  expect(forms.map((form) => form.renderCondition)).toEqual([
    `${stepBinding.stateId} === 0`,
    `${stepBinding.stateId} === 1`
  ])
  for (const [index, form] of forms.entries()) {
    const submit = form.events?.onSubmit
    expect(submit?.at(-1)).toMatchObject({
      kind: 'setState',
      targetStateId: stepBinding.stateId,
      valueExpr: String(index + 1)
    })
  }
  return { forms, stepId: stepBinding.stateId }
}

function assertNavigation(nodes: SceneNode[], stepId: string): void {
  const back = nodes.find((node) => node.bindings?.disabled)
  const writes = back?.events?.onClick ?? []
  expect(writes).toHaveLength(2)
  expect(writes.at(-1)).toMatchObject({ kind: 'setState', targetStateId: stepId })
  expect(writes.some((action) => action.kind === 'setVariable' && action.valueExpr === '""')).toBe(
    false
  )
  const restart = nodes.find((node) => node.events?.onClick?.length === 5)
  expect(restart?.interactiveProps?.type).toBe('button')
  expect(
    restart?.events?.onClick?.filter(
      (action) => action.kind === 'setVariable' && action.valueExpr === '""'
    )
  ).toHaveLength(3)
}

function assertExpressions(nodes: SceneNode[]): void {
  for (const node of nodes) {
    if (node.renderCondition) expect(parseExpression(node.renderCondition).ok).toBe(true)
    for (const actions of Object.values(node.events ?? {}))
      for (const action of actions)
        if ('valueExpr' in action && typeof action.valueExpr === 'string')
          expect(parseExpression(action.valueExpr).ok).toBe(true)
  }
}

for (const locale of ['en', 'zh-CN'])
  test(`${locale} stepper form scopes each stage's validation and preserves portable navigation`, async () => {
    const { editor, graph, pageId } = componentTemplateFixture(['stepper-form'], locale)
    try {
      const nodes = [...graph.getAllNodes()]
      const { forms, stepId } = assertStageForms(graph, pageId)
      const tree = collectTree(graph, pageId)
      expect(tree.warnings).toEqual([])
      const all = elements(tree.children)
      const formIR = all.filter((node) => node.tag === 'form')
      expect(formIR.map((form) => form.formValidationKeys?.length)).toEqual([2, 1])
      expect(
        all.filter((node) => node.validation).every((node) => node.validation?.rules.required)
      ).toBe(true)
      assertNavigation(nodes, stepId)
      assertExpressions(nodes)
      await initCodec()
      const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
      expect(restored.getPages()[0].state).toEqual(graph.getNode(pageId)?.state)
      expect(restored.getNode(restored.rootId)?.lowcodeDocumentState).toEqual(
        graph.getNode(graph.rootId)?.lowcodeDocumentState
      )
      expect(
        [...restored.getAllNodes()]
          .filter((node) => node.type === 'FORM')
          .map((node) => ({
            renderCondition: node.renderCondition,
            events: node.events
          }))
      ).toEqual(
        forms.map((node) => ({ renderCondition: node.renderCondition, events: node.events }))
      )
      for (const target of ['react', 'vue'] as const) {
        const result = compile({
          graph: restored,
          pageIds: [restored.getPages()[0].id],
          options: withDefaults({ target, router: 'none', devMode: false, sourceLocale: locale })
        })
        expect(result.warnings).toEqual([])
        typeCheckCompilerFiles(
          new Map(
            [...result.files].filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          ),
          target
        )
      }
    } finally {
      editor.dispose()
    }
  }, 35000)

test('stepper form copies keep separate state and restore both scopes in one undo', () => {
  const { editor, graph, pageId } = componentTemplateFixture([])
  try {
    const first = createComponentTemplate(editor, 'stepper-form', 'en', { parentId: pageId })
    const second = createComponentTemplate(editor, 'stepper-form', 'en', { parentId: pageId })
    expect(first.stateNames).toHaveLength(5)
    expect(second.stateNames.some((name) => first.stateNames.includes(name))).toBe(false)
    editor.undo.undo()
    expect(second.nodeIds.every((id) => !graph.getNode(id))).toBe(true)
    expect(graph.getNode(first.rootId)).toBeDefined()
    expect(graph.getNode(pageId)?.state).toHaveLength(1)
    expect(graph.getNode(graph.rootId)?.lowcodeDocumentState).toHaveLength(4)
    editor.undo.redo()
    expect(graph.getNode(second.rootId)).toBeDefined()
    expect(graph.getNode(pageId)?.state).toHaveLength(2)
    expect(graph.getNode(graph.rootId)?.lowcodeDocumentState).toHaveLength(8)
  } finally {
    editor.dispose()
  }
})
