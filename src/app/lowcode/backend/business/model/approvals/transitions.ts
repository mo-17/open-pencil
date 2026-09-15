import type {
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessLiteral,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import {
  APPROVALS_ROLES,
  APPROVAL_REQUEST_FIELDS,
  type ApprovalEntities,
  type ApprovalStatus
} from './fields'
import { APPROVAL_COMMAND_POLICIES } from './permissions'
import {
  approvalHistory,
  approvalOwnerAccess,
  approvalRead,
  approvalRevision,
  approvalState,
  approvalVersionParameter
} from './steps'

function transition(
  entities: ApprovalEntities,
  options: {
    id: string
    before?: ApprovalStatus
    after: ApprovalStatus
    access?: BackendCommandDefinitionIR['access']
    checks?: BackendCommandStepIR[]
    values?: BackendCommandValueIR[]
  }
): BackendCommandDefinitionIR {
  return businessCommand(
    options.id,
    options.id.replaceAll('-', ' '),
    options.access ?? approvalOwnerAccess(entities),
    [
      businessUUIDParameter('requestId'),
      approvalVersionParameter(),
      businessStringParameter('note', 500)
    ],
    [
      ...approvalRead(entities),
      ...(options.before ? [approvalState(options.before)] : []),
      ...(options.checks ?? []),
      approvalHistory(entities, options.id, options.after),
      businessUpdate(
        entities.requests,
        'request',
        'updated',
        [
          { field: 'status', value: businessLiteral(options.after) },
          ...(options.values ?? []),
          approvalRevision()
        ],
        APPROVAL_REQUEST_FIELDS
      )
    ],
    { resultName: 'updated', fields: [...APPROVAL_REQUEST_FIELDS] }
  )
}

export function approvalTransitionCommands(
  entities: ApprovalEntities
): BackendCommandDefinitionIR[] {
  const reset = ['first_reviewer_subject', 'second_reviewer_subject'].map((field) => ({
    field,
    value: businessLiteral(null)
  }))
  const commands = [
    transition(entities, {
      id: 'submit-oa-request',
      before: 'draft',
      after: 'pending_first',
      values: [...reset, { field: 'submitted_at', value: { kind: 'server-now' } }]
    }),
    transition(entities, {
      id: 'reopen-oa-request',
      before: 'rejected',
      after: 'draft',
      values: [...reset, { field: 'submitted_at', value: businessLiteral(null) }]
    }),
    transition(entities, {
      id: 'cancel-oa-request',
      after: 'cancelled',
      checks: [
        businessAssert(
          'not_approved',
          businessResult('request', 'status'),
          businessLiteral('approved'),
          'neq'
        ),
        businessAssert(
          'not_cancelled',
          businessResult('request', 'status'),
          businessLiteral('cancelled'),
          'neq'
        )
      ]
    })
  ]
  for (const [index, roleId] of APPROVALS_ROLES.entries()) {
    const level = index === 0 ? 'first' : 'second'
    const approvedState = index === 0 ? 'pending_second' : 'approved'
    for (const decision of ['approve', 'reject'] as const) {
      commands.push(
        transition(entities, {
          id: `${decision}-oa-${level}`,
          before: index === 0 ? 'pending_first' : 'pending_second',
          after: decision === 'reject' ? 'rejected' : approvedState,
          access: {
            kind: 'row-policy',
            entityId: entities.requests.id,
            parameter: 'requestId',
            policyIds: [APPROVAL_COMMAND_POLICIES[index]],
            roleId
          },
          checks: [
            businessAssert(
              'not_applicant',
              businessResult('request', 'owner_id'),
              businessCaller(),
              'neq'
            ),
            ...(index === 1
              ? [
                  businessAssert(
                    'first_review_complete',
                    businessResult('request', 'first_reviewer_subject'),
                    businessLiteral(null),
                    'neq'
                  ),
                  businessAssert(
                    'different_reviewer',
                    businessResult('request', 'first_reviewer_subject'),
                    businessCaller(),
                    'neq'
                  )
                ]
              : []),
            ...(decision === 'reject'
              ? [
                  businessAssert(
                    'rejection_reason',
                    { kind: 'parameter', name: 'note' },
                    businessLiteral(''),
                    'neq'
                  )
                ]
              : [])
          ],
          values: [{ field: `${level}_reviewer_subject`, value: businessCaller() }]
        })
      )
    }
  }
  return commands
}
