import type {
  BackendCommandAccessIR,
  BackendCommandLeafIR,
  BackendCommandParameterIR,
  BackendCommandStepIR,
  BackendCommandValueIR
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
  ASSET_HISTORY_FIELDS,
  ASSET_MANAGEMENT_FIELDS,
  ASSET_REQUEST_FIELDS,
  type AssetEntities,
  type AssetRequestStatus
} from './fields'

export const assetVersionParameter = (name = 'expectedVersion'): BackendCommandParameterIR => ({
  name,
  type: 'integer',
  required: true,
  min: 0,
  max: 2147483646
})
export const assetRevision = (record: string): BackendCommandValueIR => ({
  field: 'version',
  value: {
    kind: 'integer-arithmetic',
    operator: 'add',
    left: businessResult(record, 'version'),
    right: businessLiteral(1)
  }
})
export const assetVersionCheck = (record: string, parameter = 'expectedVersion') =>
  businessAssert(
    record + '_version',
    businessResult(record, 'version'),
    businessParameter(parameter)
  )
export const assetManagerAccess = (entities: AssetEntities): BackendCommandAccessIR => ({
  kind: 'row-policy',
  entityId: entities.assets.id,
  parameter: 'assetId',
  policyIds: ['manage-assets'],
  roleId: 'asset-manager'
})
export const assetNonempty = (field: string) =>
  businessAssert('nonempty_' + field, businessParameter(field), businessLiteral(''), 'neq')
export const readAsset = (entities: AssetEntities) =>
  businessRead(entities.assets, 'asset', businessParameter('assetId'), ASSET_MANAGEMENT_FIELDS)
export const assetState = (state: string) =>
  businessAssert('asset_status', businessResult('asset', 'status'), businessLiteral(state))
export const requestState = (state: AssetRequestStatus) =>
  businessAssert('request_status', businessResult('request', 'status'), businessLiteral(state))
export function readAssetRequest(entities: AssetEntities, owner = false): BackendCommandStepIR[] {
  return [
    businessRead(
      entities.requests,
      'request',
      businessParameter('requestId'),
      ['owner_id', ...ASSET_REQUEST_FIELDS],
      owner ? 'owner' : 'command'
    ),
    readAsset(entities),
    businessAssert(
      'request_asset_matches',
      businessResult('request', 'asset_id'),
      businessResult('asset', 'id')
    ),
    assetVersionCheck('request')
  ]
}

/** The ledger is manager-only and records the actor, not a mutable custodian identity. */
export function assetHistory(
  entities: AssetEntities,
  options: {
    action: string
    assetAfter?: string
    requestBefore?: AssetRequestStatus
    requestAfter?: AssetRequestStatus
    requestRecord?: string
    note?: BackendCommandLeafIR
  }
): BackendCommandStepIR {
  const after = options.assetAfter ?? 'asset'
  const request = options.requestRecord
  return businessInsert(
    entities.history,
    'history',
    [
      { field: 'owner_id', value: businessCaller() },
      { field: 'asset_id', value: businessResult('asset', 'id') },
      {
        field: 'request_id',
        value: request ? businessResult(request, 'id') : businessLiteral(null)
      },
      { field: 'actor_subject', value: businessCaller() },
      { field: 'action', value: businessLiteral(options.action) },
      { field: 'note', value: options.note ?? businessParameter('note') },
      { field: 'before_status', value: businessResult('asset', 'status') },
      { field: 'after_status', value: businessResult(after, 'status') },
      { field: 'before_version', value: businessResult('asset', 'version') },
      { field: 'after_version', value: businessResult(after, 'version') },
      { field: 'before_request_status', value: businessLiteral(options.requestBefore ?? '') },
      { field: 'after_request_status', value: businessLiteral(options.requestAfter ?? '') },
      {
        field: 'request_version',
        value: request ? businessResult(request, 'version') : businessLiteral(0)
      }
    ],
    ASSET_HISTORY_FIELDS
  )
}

export const assetRequestManagerAccess = (entities: AssetEntities): BackendCommandAccessIR => ({
  kind: 'row-policy',
  entityId: entities.requests.id,
  parameter: 'requestId',
  policyIds: ['manage-asset-requests'],
  roleId: 'asset-manager'
})
