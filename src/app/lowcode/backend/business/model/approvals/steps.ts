import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import { businessAuditIdentityValues } from '../audit-values'
import {
  businessAssert,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult
} from '../commands'
import {
  APPROVAL_HISTORY_FIELDS,
  APPROVAL_REQUEST_FIELDS,
  type ApprovalEntities,
  type ApprovalStatus
} from './fields'

export const approvalVersionParameter = (): BackendCommandParameterIR => ({
  name: 'expectedVersion',
  type: 'integer',
  required: true,
  min: 0,
  max: 2147483647
})
export const approvalOwnerAccess = (
  entities: ApprovalEntities
): BackendCommandDefinitionIR['access'] => ({
  kind: 'row-policy',
  entityId: entities.requests.id,
  parameter: 'requestId',
  policyIds: ['own-oa-requests']
})
export const approvalRevision = (): BackendCommandValueIR => ({
  field: 'version',
  value: {
    kind: 'integer-arithmetic',
    operator: 'add',
    left: businessResult('request', 'version'),
    right: businessLiteral(1)
  }
})
export function approvalRead(entities: ApprovalEntities): BackendCommandStepIR[] {
  return [
    businessRead(entities.requests, 'request', businessParameter('requestId'), [
      'owner_id',
      ...APPROVAL_REQUEST_FIELDS
    ]),
    businessAssert(
      'expected_version',
      businessResult('request', 'version'),
      businessParameter('expectedVersion')
    )
  ]
}
export const approvalState = (status: ApprovalStatus) =>
  businessAssert('expected_status', businessResult('request', 'status'), businessLiteral(status))
export function approvalHistory(
  entities: ApprovalEntities,
  action: string,
  after: ApprovalStatus,
  created = false
): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    'history',
    [
      ...businessAuditIdentityValues('request', 'request_id', action, created),
      { field: 'before_status', value: businessResult('request', 'status') },
      { field: 'after_status', value: businessLiteral(after) },
      { field: 'before_version', value: businessResult('request', 'version') },
      { field: 'after_version', value: created ? businessLiteral(0) : approvalRevision().value }
    ],
    APPROVAL_HISTORY_FIELDS
  )
}
