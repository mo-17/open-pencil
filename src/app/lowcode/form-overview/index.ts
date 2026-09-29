import { moduleValueFields, type ModuleValueField } from '@open-pencil/core/plugins'
import {
  auditValidatedFormControls,
  findComponentMasterAncestor,
  isCheckboxGroupControl,
  isInteractivePropsObject,
  validateInteractiveProps,
  type FormControlBindingStatus
} from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode, StateDef, StateValueType } from '@open-pencil/scene-graph'

import { inspectFormSubmission } from './submission'
import type { FormOverview, FormOverviewField } from './types'

export type { FormOverviewTarget } from './types'

const FIELD_TYPES: ReadonlySet<SceneNode['type']> = new Set([
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'RADIO',
  'DATEPICKER',
  'CHECKBOX',
  'SWITCH'
])

function containingForm(graph: SceneGraph, selected: SceneNode): SceneNode | undefined {
  if (
    selected.type !== 'FORM' &&
    selected.type !== 'BUTTON' &&
    !FIELD_TYPES.has(selected.type) &&
    !moduleValueFields(selected).length
  )
    return undefined
  let current: SceneNode | undefined = selected
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (current.type === 'FORM') return current
    seen.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

function containingPage(graph: SceneGraph, node: SceneNode): SceneNode | undefined {
  let current: SceneNode | undefined = node
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (current.type === 'CANVAS') return current
    seen.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return undefined
}

/** Same controlled-value choices as ValueBindingPanel, including legal document state in masters. */
function bindingStatus(
  graph: SceneGraph,
  node: SceneNode,
  pageStates: readonly StateDef[],
  documentStates: readonly StateDef[],
  field?: ModuleValueField
): FormControlBindingStatus {
  const binding = node.bindings?.[field?.key ?? 'value']
  if (!binding) return 'missing'
  let target: StateDef | undefined
  if (binding.kind === 'ref') target = pageStates.find((state) => state.id === binding.stateId)
  else if (binding.kind === 'docState')
    target = documentStates.find((state) => state.name === binding.docStateName)
  if (!target) return 'invalid'
  if (
    binding.kind === 'ref' &&
    (target.computedExpr !== undefined || findComponentMasterAncestor(graph, node))
  )
    return 'invalid'
  let allowed: readonly StateValueType[] = ['string']
  if (field) allowed = [field.type]
  else if (node.type === 'INPUT') allowed = ['string', 'number']
  else if (node.type === 'SWITCH') allowed = ['boolean']
  else if (node.type === 'CHECKBOX') allowed = [isCheckboxGroupControl(node) ? 'array' : 'boolean']
  return allowed.includes(target.type) ? 'valid' : 'invalid'
}

function validationStatus(
  node: SceneNode,
  field?: ModuleValueField
): Pick<FormOverviewField, 'validation' | 'asynchronous'> {
  const raw = node.interactiveProps?.[field?.validationKey ?? 'validation']
  if (raw === undefined) return { validation: 'none', asynchronous: false }
  const invalid =
    validateInteractiveProps(field ? 'INPUT' : node.type, { validation: raw }).length > 0
  if (!isInteractivePropsObject(raw)) return { validation: 'invalid', asynchronous: false }
  const asynchronous = raw.async !== undefined
  const configured =
    raw.required === true ||
    asynchronous ||
    ['pattern', 'customExpr', 'minLength', 'maxLength', 'min', 'max'].some(
      (key) => raw[key] !== undefined
    )
  const validation = configured ? 'configured' : 'none'
  return { validation: invalid ? 'invalid' : validation, asynchronous }
}

/** A bounded, read-only configuration view; compilation and validation remain with their owners. */
export function inspectFormOverview(graph: SceneGraph, selectedId: string): FormOverview | null {
  const selected = graph.getNode(selectedId)
  const form = selected && containingForm(graph, selected)
  if (!form) return null
  const pageStates = containingPage(graph, form)?.state ?? []
  const documentStates = graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []
  const audit = auditValidatedFormControls(graph, form.id, {
    limit: 200,
    moduleFields: moduleValueFields
  })
  const validated = new Map(
    audit.ok
      ? audit.data.controls.map((field) => [field.id + (field.fieldKey ?? ''), field.bindingStatus])
      : []
  )
  const descendants = inspectDescendants(graph, form, (node) => {
    const endpoints = moduleValueFields(node)
    if (endpoints.length)
      return endpoints.map((field) => ({
        id: node.id,
        name: node.name,
        valueKey: field.key,
        binding:
          validated.get(node.id + field.key) ??
          bindingStatus(graph, node, pageStates, documentStates, field),
        ...validationStatus(node, field)
      }))
    return [
      {
        id: node.id,
        name: node.name,
        binding: validated.get(node.id) ?? bindingStatus(graph, node, pageStates, documentStates),
        ...validationStatus(node)
      }
    ]
  })
  return {
    formId: form.id,
    name: form.name,
    ...descendants,
    submission: inspectFormSubmission(form.events?.onSubmit ?? [], documentStates)
  }
}

function inspectDescendants(
  graph: SceneGraph,
  form: SceneNode,
  inspectField: (node: SceneNode) => FormOverviewField[]
): Pick<FormOverview, 'fields' | 'clickButtons' | 'truncated'> {
  const fields: FormOverviewField[] = []
  const clickButtons: FormOverview['clickButtons'] = []
  const pending = [...form.childIds].reverse()
  const seen = new Set<string>()
  while (pending.length && seen.size < 5000 && fields.length < 200) {
    const id = pending.pop()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const node = graph.getNode(id)
    if (!node || ['FORM', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(node.type)) continue
    if (FIELD_TYPES.has(node.type) || moduleValueFields(node).length)
      fields.push(...inspectField(node))
    if (node.type === 'BUTTON' && node.events?.onClick?.length)
      clickButtons.push({ id: node.id, name: node.name, actionId: node.events.onClick[0].id })
    pending.push(...[...node.childIds].reverse())
  }
  return {
    fields,
    clickButtons,
    truncated: pending.length > 0
  }
}
