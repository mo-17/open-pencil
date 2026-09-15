import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCommand,
  businessLiteral,
  businessParameter,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { ASSET_MANAGEMENT_FIELDS, ASSET_REQUEST_FIELDS, type AssetEntities } from './fields'
import {
  assetHistory,
  assetRequestManagerAccess,
  assetNonempty,
  assetRevision,
  assetState,
  assetVersionParameter,
  readAssetRequest,
  requestState
} from './steps'

const keys = () => [
  businessUUIDParameter('assetId'),
  businessUUIDParameter('requestId'),
  assetVersionParameter(),
  businessStringParameter('note', 500)
]

export function assetIssueCommands(entities: AssetEntities): BackendCommandDefinitionIR[] {
  return (['assignment', 'loan'] as const).map((kind) =>
    businessCommand(
      'issue-asset-' + kind,
      'Confirm physical asset handover for ' + kind,
      assetRequestManagerAccess(entities),
      [
        ...keys(),
        ...(kind === 'loan'
          ? [{ name: 'dueAt', type: 'datetime' as const, required: true as const }]
          : [])
      ],
      [
        ...readAssetRequest(entities),
        assetState('available'),
        requestState('requested'),
        assetNonempty('note'),
        businessAssert('request_kind', businessResult('request', 'kind'), businessLiteral(kind)),
        businessAssert(
          'no_current_request',
          businessResult('asset', 'current_request_id'),
          businessLiteral(null)
        ),
        businessAssert(
          'no_custodian',
          businessResult('asset', 'custodian_subject'),
          businessLiteral(null)
        ),
        ...(kind === 'loan'
          ? [
              businessAssert(
                'original_loan_due',
                businessResult('request', 'due_at'),
                businessParameter('dueAt')
              ),
              businessAssert(
                'future_loan_due',
                businessParameter('dueAt'),
                { kind: 'server-now' },
                'gte'
              )
            ]
          : []),
        businessUpdate(
          entities.assets,
          'asset',
          'updated_asset',
          [
            { field: 'status', value: businessLiteral('in_use') },
            { field: 'custodian_subject', value: businessResult('request', 'owner_id') },
            { field: 'current_request_id', value: businessResult('request', 'id') },
            assetRevision('asset')
          ],
          ASSET_MANAGEMENT_FIELDS
        ),
        businessUpdate(
          entities.requests,
          'request',
          'updated_request',
          [
            { field: 'status', value: businessLiteral('issued') },
            { field: 'issued_at', value: { kind: 'server-now' } },
            { field: 'fulfillment_note', value: businessParameter('note') },
            assetRevision('request')
          ],
          ASSET_REQUEST_FIELDS
        ),
        assetHistory(entities, {
          action: 'issued-' + kind,
          assetAfter: 'updated_asset',
          requestRecord: 'updated_request',
          requestBefore: 'requested',
          requestAfter: 'issued'
        })
      ],
      { resultName: 'updated_request', fields: [...ASSET_REQUEST_FIELDS] }
    )
  )
}

export function assetReturnCommand(entities: AssetEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'return-asset-request',
    'Confirm physical return and clear custody',
    assetRequestManagerAccess(entities),
    keys(),
    [
      ...readAssetRequest(entities),
      assetState('in_use'),
      requestState('issued'),
      assetNonempty('note'),
      businessAssert(
        'current_request_matches',
        businessResult('asset', 'current_request_id'),
        businessResult('request', 'id')
      ),
      businessAssert(
        'custodian_matches',
        businessResult('asset', 'custodian_subject'),
        businessResult('request', 'owner_id')
      ),
      businessUpdate(
        entities.assets,
        'asset',
        'updated_asset',
        [
          { field: 'status', value: businessLiteral('available') },
          { field: 'custodian_subject', value: businessLiteral(null) },
          { field: 'current_request_id', value: businessLiteral(null) },
          assetRevision('asset')
        ],
        ASSET_MANAGEMENT_FIELDS
      ),
      businessUpdate(
        entities.requests,
        'request',
        'updated_request',
        [
          { field: 'status', value: businessLiteral('returned') },
          { field: 'returned_at', value: { kind: 'server-now' } },
          { field: 'fulfillment_note', value: businessParameter('note') },
          assetRevision('request')
        ],
        ASSET_REQUEST_FIELDS
      ),
      assetHistory(entities, {
        action: 'returned',
        assetAfter: 'updated_asset',
        requestRecord: 'updated_request',
        requestBefore: 'issued',
        requestAfter: 'returned'
      })
    ],
    { resultName: 'updated_request', fields: [...ASSET_REQUEST_FIELDS] }
  )
}
