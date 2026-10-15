import { expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { moduleValueFields } from '@open-pencil/core/plugins'
import { auditValidatedFormControls, planValidatedFormValueBindings } from '@open-pencil/lowcode'

import {
  moduleValuesFixture,
  moduleValuesGraph
} from '#tests/helpers/compiler/components/module-values/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'
for (const target of ['react', 'vue'] as const)
  test(`${target} typed module form includes independent scalar and path state fields`, () => {
    const result = moduleValuesFixture(target)
    expect(result.warnings).toEqual([])
    typeCheckCompilerFiles(result.files, target)
  }, 35000)
test('FORM validates both endpoints and document state ownership without changing defaults', () => {
  const { graph, page, dates } = moduleValuesGraph(),
    tree = collectTree(graph, page.id),
    form = tree.children[0] as IRElement
  expect(form.formValidationKeys).toHaveLength(6)
  expect(form.formValidationKeys).toContain(dates.id + ':endValue')
  expect(tree.docStateReads).toEqual(['endDate'])
  expect(tree.docStateWrites).toEqual(['endDate'])
  expect(
    tree.validatedFields?.find((field) => field.stateName === 'rating')?.rules.min
  ).toBeGreaterThan(0)
  expect(
    graph.getNode(page.id)?.state?.find((state) => state.name === 'rating')?.defaultValue
  ).toBe(0)
})
test('invalid and expression module value bindings retain absence, never acquire writes', () => {
  const { graph, page, slider } = moduleValuesGraph()
  graph.updateNode(slider.id, {
    bindings: {
      value: { kind: 'ref', stateId: 'missing' },
      endValue: { kind: 'expr', expr: 'end' }
    }
  })
  const tree = collectTree(graph, page.id),
    form = tree.children[0] as IRElement,
    module = (form.children[0] as IRElement).module
  expect(module?.valueFields).toHaveLength(2)
  for (const field of module?.valueFields ?? []) {
    expect(field.read).toEqual({ kind: 'ident', name: 'undefined' })
    expect(field.write).toBeUndefined()
  }
  expect(
    tree.warnings.filter((warning) => warning.code === 'module-value-binding-invalid')
  ).toHaveLength(2)
})
test('generic module field name becomes the FORM serialization key and invalid names never fall back', () => {
  const { graph, page, slider } = moduleValuesGraph()
  graph.updateNode(slider.id, {
    interactiveProps: {
      ...slider.interactiveProps,
      moduleFieldNames: { value: 'amount_due' }
    }
  })
  let tree = collectTree(graph, page.id)
  let form = tree.children[0] as IRElement
  let module = (form.children[0] as IRElement).module
  expect(module?.valueFields?.find((field) => field.key === 'value')?.name).toBe('amount_due')
  graph.updateNode(slider.id, {
    interactiveProps: {
      ...slider.interactiveProps,
      moduleFieldNames: { value: 'bad name' }
    }
  })
  tree = collectTree(graph, page.id)
  form = tree.children[0] as IRElement
  module = (form.children[0] as IRElement).module
  expect(module?.valueFields?.find((field) => field.key === 'value')?.name).toBeUndefined()
  expect(tree.warnings.some((warning) => warning.code === 'module-field-name-invalid')).toBe(true)
})
test('module audits and repairs preserve both endpoints, independent types and unrelated bindings', () => {
  const { graph, page, form, slider } = moduleValuesGraph()
  graph.updateNode(slider.id, { bindings: { text: { kind: 'literal', literalValue: 'keep' } } })
  const result = planValidatedFormValueBindings(graph, form.id, { moduleFields: moduleValueFields })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.data.bindings).toHaveLength(2)
  for (const repair of result.data.bindings)
    graph.updateNode(repair.nodeId, { bindings: repair.bindings })
  graph.updateNode(page.id, { state: result.data.nextState })
  expect<unknown>(graph.getNode(slider.id)?.bindings?.text).toEqual({
    kind: 'literal',
    literalValue: 'keep'
  })
  const audit = auditValidatedFormControls(graph, form.id, { moduleFields: moduleValueFields })
  expect(audit.ok).toBe(true)
  if (audit.ok) expect(audit.data.summary).toMatchObject({ validated: 6, valid: 6, missing: 0 })
})

test('a missing dual binding is one mutation per node with two distinct states', async () => {
  const { FigmaAPI } = await import('@open-pencil/core/figma-api')
  const { createEditor } = await import('@open-pencil/core/editor')
  const { getTool } = await import('#tests/helpers/tools')
  const { graph, slider } = moduleValuesGraph()
  graph.updateNode(slider.id, { bindings: {} })
  const editor = createEditor({ graph, skipInitialGraphSetup: true }),
    figma = new FigmaAPI(graph)
  try {
    const before = JSON.stringify(graph.getNode(slider.id)?.bindings)
    const result = getTool('ensure_form_value_bindings').execute(
      figma,
      { scope_id: slider.id },
      { editor }
    ) as { ok: boolean; data?: { createdStates: number; boundNodeIds: string[] }; error?: string }
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.data?.createdStates).toBe(2)
    expect(result.data?.boundNodeIds).toEqual([slider.id])
    expect(graph.getNode(slider.id)?.bindings?.value).toBeDefined()
    expect(graph.getNode(slider.id)?.bindings?.endValue).toBeDefined()
    editor.undo.undo()
    expect(JSON.stringify(graph.getNode(slider.id)?.bindings)).toBe(before)
  } finally {
    editor.dispose()
  }
})

test('readonly module endpoints remain bound without uncorrectable FORM validators', () => {
  const { graph, page, dates } = moduleValuesGraph()
  graph.updateNode(dates.id, { interactiveProps: { ...dates.interactiveProps, readOnly: true } })
  const tree = collectTree(graph, page.id),
    form = tree.children[0] as IRElement
  const date = form.children.find(
    (child) => child.kind === 'element' && child.module?.moduleType === 'date-range'
  ) as IRElement
  expect(date.module?.valueFields?.every((field) => field.write && !field.validation)).toBe(true)
  expect(form.formValidationKeys).not.toContain(dates.id)
  expect(form.formValidationKeys).not.toContain(dates.id + ':endValue')
})

test('explicit module FORM reassignment fails closed without split ownership', () => {
  const { graph, page, dates } = moduleValuesGraph()
  graph.updateNode(dates.id, { interactiveProps: { ...dates.interactiveProps, form: 'other' } })
  const tree = collectTree(graph, page.id),
    form = tree.children[0] as IRElement
  const date = form.children.find(
    (child) => child.kind === 'element' && child.module?.moduleType === 'date-range'
  ) as IRElement
  expect(date.attrs.disabled).toBe(true)
  expect(date.attrs.form).toBeUndefined()
  expect(
    date.module?.valueFields?.every((field) => !field.write && !field.name && !field.validation)
  ).toBe(true)
  expect(tree.warnings.some((warning) => warning.code === 'module-form-owner-unsupported')).toBe(
    true
  )
  expect(form.formValidationKeys).not.toContain(dates.id)
})

test('ambiguous page state and computed document state are rejected consistently by audit and compiler', () => {
  const { graph, page, form, slider, dates } = moduleValuesGraph()
  graph.updateNode(page.id, {
    state: [
      ...(page.state ?? []),
      { id: 'amount-duplicate', name: 'amount', type: 'number', defaultValue: 90 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      {
        id: 'endDate',
        name: 'endDate',
        type: 'string',
        defaultValue: '',
        computedExpr: '"2026-01-01"'
      }
    ]
  })
  const tree = collectTree(graph, page.id),
    irform = tree.children[0] as IRElement
  const fields = irform.children.flatMap((child) =>
    child.kind === 'element' ? (child.module?.valueFields ?? []) : []
  )
  expect(
    fields.filter((field) => field.key === 'value' && field.write?.name === 'amount')
  ).toHaveLength(0)
  expect(fields.filter((field) => field.write?.name === 'endDate')).toHaveLength(0)
  const audit = auditValidatedFormControls(graph, form.id, { moduleFields: moduleValueFields })
  expect(audit.ok).toBe(true)
  if (audit.ok) {
    expect(
      audit.data.controls.find(
        (control) => control.id === slider.id && control.fieldKey === 'value'
      )?.bindingStatus
    ).toBe('invalid')
    expect(
      audit.data.controls.find(
        (control) => control.id === dates.id && control.fieldKey === 'endValue'
      )?.bindingStatus
    ).toBe('invalid')
  }
})
