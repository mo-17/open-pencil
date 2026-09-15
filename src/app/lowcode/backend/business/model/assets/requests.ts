import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { ASSET_REQUEST_FIELDS, type AssetEntities } from './fields'
import {
  assetHistory,
  assetRequestManagerAccess,
  assetNonempty,
  assetRevision,
  assetState,
  assetVersionParameter,
  readAsset,
  readAssetRequest,
  requestState
} from './steps'

export function assetRequestCommands(entities: AssetEntities): BackendCommandDefinitionIR[] {
  return (['assignment', 'loan'] as const).map((kind) =>
    businessCommand(
      'request-asset-' + kind,
      'Request an available asset for ' + kind,
      {
        kind: 'row-policy',
        entityId: entities.assets.id,
        parameter: 'assetId',
        policyIds: ['available-assets']
      },
      [
        businessUUIDParameter('assetId'),
        businessStringParameter('borrowerName', 100),
        businessStringParameter('purpose', 1000),
        ...(kind === 'loan'
          ? [{ name: 'dueAt', type: 'datetime' as const, required: true as const }]
          : [])
      ],
      [
        readAsset(entities),
        assetState('available'),
        assetNonempty('borrowerName'),
        assetNonempty('purpose'),
        ...(kind === 'loan'
          ? [
              businessAssert(
                'future_loan_due',
                businessParameter('dueAt'),
                { kind: 'server-now' },
                'gte'
              )
            ]
          : []),
        businessInsert(
          entities.requests,
          'request',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'asset_id', value: businessResult('asset', 'id') },
            { field: 'asset_tag', value: businessResult('asset', 'tag') },
            { field: 'asset_title', value: businessResult('asset', 'title') },
            { field: 'borrower_name', value: businessParameter('borrowerName') },
            { field: 'purpose', value: businessParameter('purpose') },
            { field: 'kind', value: businessLiteral(kind) },
            ...(kind === 'loan' ? [{ field: 'due_at', value: businessParameter('dueAt') }] : [])
          ],
          ASSET_REQUEST_FIELDS
        ),
        assetHistory(entities, {
          action: 'requested-' + kind,
          requestRecord: 'request',
          requestAfter: 'requested',
          note: businessParameter('purpose')
        })
      ],
      { resultName: 'request', fields: [...ASSET_REQUEST_FIELDS] }
    )
  )
}

export function assetWithdrawCommands(entities: AssetEntities): BackendCommandDefinitionIR[] {
  return [false, true].map((manager) => {
    const status = manager ? 'rejected' : 'cancelled'
    return businessCommand(
      manager ? 'reject-asset-request' : 'cancel-asset-request',
      manager ? 'Reject an unfulfilled asset request' : 'Cancel my unfulfilled request',
      manager
        ? assetRequestManagerAccess(entities)
        : {
            kind: 'row-policy',
            entityId: entities.requests.id,
            parameter: 'requestId',
            policyIds: ['own-asset-requests']
          },
      [
        businessUUIDParameter('assetId'),
        businessUUIDParameter('requestId'),
        assetVersionParameter(),
        businessStringParameter('note', 500)
      ],
      [
        ...readAssetRequest(entities, !manager),
        requestState('requested'),
        assetNonempty('note'),
        businessUpdate(
          entities.requests,
          'request',
          'updated_request',
          [
            { field: 'status', value: businessLiteral(status) },
            { field: 'fulfillment_note', value: businessParameter('note') },
            assetRevision('request')
          ],
          ASSET_REQUEST_FIELDS
        ),
        assetHistory(entities, {
          action: status,
          requestRecord: 'updated_request',
          requestBefore: 'requested',
          requestAfter: status
        })
      ],
      { resultName: 'updated_request', fields: [...ASSET_REQUEST_FIELDS] }
    )
  })
}
