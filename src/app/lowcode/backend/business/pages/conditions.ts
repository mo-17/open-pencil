import { BackendDraftOperationError } from '@/app/lowcode/backend/draft'

import type { BusinessActionCondition, BusinessActionWhen } from '../types'
import { businessLiteral } from './state'

function requireCondition(condition: unknown): asserts condition {
  if (!condition)
    throw new BackendDraftOperationError('Business template: invalid action condition')
}

function conditionObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Flat bounded metadata only: values within a field are OR, fields in all are AND. */
export function businessActionConditions(
  when: BusinessActionWhen
): readonly BusinessActionCondition[] {
  requireCondition(conditionObject(when))
  if ('all' in when)
    requireCondition(
      Object.keys(when).length === 1 &&
        Array.isArray(when.all) &&
        when.all.length > 0 &&
        when.all.length <= 4
    )
  const conditions = 'all' in when ? when.all : [when]
  for (const condition of conditions) {
    requireCondition(conditionObject(condition))
    requireCondition(
      Object.keys(condition).length === 2 &&
        typeof condition.field === 'string' &&
        Array.isArray(condition.values) &&
        condition.values.length > 0 &&
        condition.values.length <= 16 &&
        condition.values.every(
          (value) =>
            typeof value === 'boolean' || (typeof value === 'string' && value.length <= 200)
        )
    )
  }
  return conditions
}

export function businessActionConditionExpression(
  when: BusinessActionWhen,
  selected: string
): string {
  return businessActionConditions(when)
    .map(
      ({ field, values }) =>
        '(' +
        values.map((value) => `${selected}.${field} === ${businessLiteral(value)}`).join(' || ') +
        ')'
    )
    .join(' && ')
}
