import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandStepIR,
  BackendCommandValueIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult
} from '../commands'
import {
  HR_CANDIDATE_FIELDS,
  HR_EMPLOYEE_FIELDS,
  HR_HISTORY_FIELDS,
  HR_POSITION_FIELDS,
  type RecruitmentEntities
} from './fields'
import { recruitmentPolicy } from './permissions'

export const hrVersionParameter = (): BackendCommandParameterIR => ({
  name: 'expectedVersion',
  type: 'integer',
  required: true,
  min: 0,
  max: 2147483646
})
export const hrVersion = (record: string) =>
  businessAssert(
    'expected_version',
    businessResult(record, 'version'),
    businessParameter('expectedVersion')
  )
export const hrRequired = (parameter: string) =>
  businessAssert(`required_${parameter}`, businessParameter(parameter), businessLiteral(''), 'neq')
export const hrState = (record: string, status: string) =>
  businessAssert(`status_${record}`, businessResult(record, 'status'), businessLiteral(status))
export const hrIncrement = (record: string, field = 'version'): BackendCommandValueIR => ({
  field,
  value: {
    kind: 'integer-arithmetic',
    operator: 'add',
    left: businessResult(record, field),
    right: businessLiteral(1)
  }
})
export const hrPositionAccess = (
  entities: RecruitmentEntities
): BackendCommandDefinitionIR['access'] => ({
  kind: 'row-policy',
  entityId: entities.positions.id,
  parameter: 'positionId',
  policyIds: [recruitmentPolicy(entities.positions)]
})
export const hrReadPosition = (entities: RecruitmentEntities) =>
  businessRead(
    entities.positions,
    'position',
    businessParameter('positionId'),
    ['owner_id', ...HR_POSITION_FIELDS],
    'owner'
  )
export const hrOpenPosition = () =>
  businessAssert('position_open', businessResult('position', 'active'), businessLiteral(true))
export function hrReadChild(
  entity: DataEntityIR,
  record: string,
  fields: readonly string[]
): BackendCommandStepIR[] {
  return [
    businessRead(
      entity,
      record,
      businessParameter(`${record}Id`),
      ['owner_id', ...fields],
      'owner'
    ),
    businessAssert(
      `${record}_position`,
      businessResult(record, 'position_id'),
      businessResult('position', 'id')
    )
  ]
}
export const hrReadCandidate = (entities: RecruitmentEntities) =>
  hrReadChild(entities.candidates, 'candidate', HR_CANDIDATE_FIELDS)
export const hrReadEmployee = (entities: RecruitmentEntities) =>
  hrReadChild(entities.employees, 'employee', HR_EMPLOYEE_FIELDS)

export function hrCandidateReferences(): BackendCommandValueIR[] {
  return [
    { field: 'owner_id', value: businessResult('position', 'owner_id') },
    { field: 'position_id', value: businessResult('position', 'id') },
    { field: 'candidate_id', value: businessResult('candidate', 'id') }
  ]
}

export function hrHistory(
  entities: RecruitmentEntities,
  record: string,
  kind: string,
  action: string,
  created = false,
  related?: string
): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    `audit_${record}`,
    [
      {
        field: 'owner_id',
        value: created ? businessCaller() : businessResult('position', 'owner_id')
      },
      { field: 'position_id', value: businessResult('position', 'id') },
      { field: 'target_id', value: businessResult(record, 'id') },
      { field: 'target_kind', value: businessLiteral(kind) },
      {
        field: 'related_id',
        value: related ? businessResult(related, 'id') : businessLiteral(null)
      },
      { field: 'actor_subject', value: businessCaller() },
      { field: 'action', value: businessLiteral(action) },
      { field: 'note', value: created ? businessLiteral('') : businessParameter('note') },
      { field: 'before_version', value: businessResult(record, 'version') },
      { field: 'after_version', value: created ? businessLiteral(0) : hrIncrement(record).value }
    ],
    HR_HISTORY_FIELDS
  )
}

export function hrWorkingPhase(): BackendCommandStepIR[] {
  return ['active', 'departed'].map((status) =>
    businessAssert(
      `phase_not_${status}`,
      businessResult('employee', 'status'),
      businessLiteral(status),
      'neq'
    )
  )
}
