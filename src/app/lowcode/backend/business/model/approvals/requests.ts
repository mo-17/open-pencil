import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import {
  APPROVALS_KINDS,
  APPROVAL_REQUEST_FIELDS,
  type ApprovalEntities,
  type ApprovalKind
} from './fields'
import {
  approvalHistory,
  approvalOwnerAccess,
  approvalRead,
  approvalRevision,
  approvalState,
  approvalVersionParameter
} from './steps'

function fields(kind: ApprovalKind): {
  parameters: BackendCommandParameterIR[]
  values: BackendCommandValueIR[]
  checks: BackendCommandStepIR[]
} {
  const leave = kind === 'leave'
  return {
    parameters: [
      businessStringParameter('title', 200),
      businessStringParameter('description', 2000),
      ...(leave
        ? [
            { name: 'startsAt', type: 'datetime' as const, required: true as const },
            { name: 'endsAt', type: 'datetime' as const, required: true as const }
          ]
        : [
            {
              name: 'amountCents',
              type: 'integer' as const,
              required: true as const,
              min: 1,
              max: 100000000
            }
          ])
    ],
    values: [
      { field: 'title', value: businessParameter('title') },
      { field: 'description', value: businessParameter('description') },
      ...(leave
        ? [
            { field: 'starts_at', value: businessParameter('startsAt') },
            { field: 'ends_at', value: businessParameter('endsAt') }
          ]
        : [{ field: 'amount_cents', value: businessParameter('amountCents') }])
    ],
    checks: [
      businessAssert('nonempty_title', businessParameter('title'), businessLiteral(''), 'neq'),
      ...(leave
        ? [
            businessAssert(
              'ordered_dates',
              businessParameter('endsAt'),
              businessParameter('startsAt'),
              'gte'
            ),
            businessAssert(
              'positive_duration',
              businessParameter('endsAt'),
              businessParameter('startsAt'),
              'neq'
            )
          ]
        : [])
    ]
  }
}

export function approvalRequestCommands(entities: ApprovalEntities): BackendCommandDefinitionIR[] {
  return APPROVALS_KINDS.flatMap((kind) => {
    const inputs = fields(kind)
    return [
      businessCommand(
        `create-oa-${kind}`,
        `Create a ${kind} application draft`,
        { kind: 'authenticated' },
        inputs.parameters,
        [
          ...inputs.checks,
          businessInsert(
            entities.requests,
            'request',
            [
              { field: 'owner_id', value: businessCaller() },
              { field: 'applicant_subject', value: businessCaller() },
              { field: 'kind', value: businessLiteral(kind) },
              ...inputs.values
            ],
            ['owner_id', ...APPROVAL_REQUEST_FIELDS]
          ),
          approvalHistory(entities, 'created', 'draft', true)
        ],
        { resultName: 'request', fields: [...APPROVAL_REQUEST_FIELDS] }
      ),
      businessCommand(
        `update-oa-${kind}`,
        `Edit my ${kind} application draft`,
        approvalOwnerAccess(entities),
        [
          businessUUIDParameter('requestId'),
          approvalVersionParameter(),
          ...inputs.parameters,
          businessStringParameter('note', 500)
        ],
        [
          ...approvalRead(entities),
          approvalState('draft'),
          businessAssert('expected_kind', businessResult('request', 'kind'), businessLiteral(kind)),
          ...inputs.checks,
          approvalHistory(entities, 'edited', 'draft'),
          businessUpdate(
            entities.requests,
            'request',
            'updated',
            [...inputs.values, approvalRevision()],
            APPROVAL_REQUEST_FIELDS
          )
        ],
        { resultName: 'updated', fields: [...APPROVAL_REQUEST_FIELDS] }
      )
    ]
  })
}
