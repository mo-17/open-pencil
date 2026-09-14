import { parseBackendFieldDefault } from '../field-default-validation'
import type { AuthRowConditionIR, DataEntityIR, DataModelIR } from '../types'
import {
  diagnostic,
  id,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from '../validation-helpers'

export function parseAuthConditions(
  value: unknown,
  path: string,
  context: BackendValidationContext
): AuthRowConditionIR[] | undefined {
  const conditions = parseArrayItems(value, path, context, 8, (entry, itemPath, ctx) => {
    const source = record(entry, itemPath, ctx, ['fieldId', 'value'])
    if (!source) return undefined
    const fieldId = id(source.fieldId, itemPath + '.fieldId', ctx)
    const scalar = source.value
    if (
      scalar !== null &&
      typeof scalar !== 'boolean' &&
      !(typeof scalar === 'number' && Number.isFinite(scalar)) &&
      !(
        typeof scalar === 'string' &&
        scalar.length <= 512 &&
        !scalar.includes('\u0000') &&
        !/[\uD800-\uDFFF]/u.test(scalar)
      )
    ) {
      diagnostic(
        ctx,
        'backend-auth-condition-invalid',
        itemPath,
        'Policy conditions require bounded finite scalar constants.'
      )
      return undefined
    }
    return fieldId ? { fieldId, value: scalar } : undefined
  })
  if (!conditions) return undefined
  if (!conditions.length)
    diagnostic(
      context,
      'backend-auth-condition-invalid',
      path,
      'Omit conditions when no fixed predicate is required.'
    )
  uniqueBy(
    conditions.map((entry) => entry.fieldId),
    path,
    context,
    'policy condition field'
  )
  return sorted(conditions, (entry) => entry.fieldId)
}

export function validateAuthConditions(
  conditions: readonly AuthRowConditionIR[] | undefined,
  entity: DataEntityIR | undefined,
  model: DataModelIR,
  path: string,
  context: BackendValidationContext
): void {
  for (const condition of conditions ?? []) {
    const field = entity?.fields.find((entry) => entry.id === condition.fieldId)
    if (!field || ['json', 'bytes'].includes(field.type)) {
      diagnostic(
        context,
        'backend-auth-condition-invalid',
        path,
        'Fixed policy predicates require existing scalar fields.'
      )
      continue
    }
    parseBackendFieldDefault(
      { kind: 'literal', value: condition.value },
      path,
      context,
      field.type,
      field.nullable
    )
    if (
      field.type === 'enum' &&
      condition.value !== null &&
      !model.enums.some(
        (entry) => entry.id === field.enumId && entry.values.includes(String(condition.value))
      )
    )
      diagnostic(
        context,
        'backend-auth-condition-invalid',
        path,
        'Policy enum constants must be declared members.'
      )
  }
}
