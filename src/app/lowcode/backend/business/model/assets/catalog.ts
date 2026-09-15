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
import { ASSET_MANAGEMENT_FIELDS, type AssetEntities } from './fields'
import {
  assetHistory,
  assetManagerAccess,
  assetNonempty,
  assetRevision,
  assetState,
  assetVersionCheck,
  assetVersionParameter,
  readAsset
} from './steps'

export function assetCatalogCommands(entities: AssetEntities): BackendCommandDefinitionIR[] {
  const parameters = () => [
    businessStringParameter('title', 200),
    businessStringParameter('category', 100),
    businessStringParameter('location', 200),
    businessStringParameter('description', 2000)
  ]
  const values = () =>
    ['title', 'category', 'location', 'description'].map((field) => ({
      field,
      value: businessParameter(field)
    }))
  return [
    businessCommand(
      'create-asset',
      'Register one uniquely tagged asset',
      { kind: 'role', roleId: 'asset-manager' },
      [businessStringParameter('tag', 100), ...parameters()],
      [
        assetNonempty('tag'),
        assetNonempty('title'),
        businessInsert(
          entities.assets,
          'asset',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'registered_by', value: businessCaller() },
            { field: 'tag', value: businessParameter('tag') },
            ...values()
          ],
          ASSET_MANAGEMENT_FIELDS
        ),
        assetHistory(entities, { action: 'registered', note: businessParameter('description') })
      ],
      { resultName: 'asset', fields: [...ASSET_MANAGEMENT_FIELDS] }
    ),
    businessCommand(
      'update-asset',
      'Edit an available asset without changing its tag or custody',
      assetManagerAccess(entities),
      [
        businessUUIDParameter('assetId'),
        assetVersionParameter(),
        ...parameters(),
        businessStringParameter('note', 500)
      ],
      [
        readAsset(entities),
        assetVersionCheck('asset'),
        assetState('available'),
        assetNonempty('title'),
        assetNonempty('note'),
        businessUpdate(
          entities.assets,
          'asset',
          'updated_asset',
          [...values(), assetRevision('asset')],
          ASSET_MANAGEMENT_FIELDS
        ),
        assetHistory(entities, { action: 'updated', assetAfter: 'updated_asset' })
      ],
      { resultName: 'updated_asset', fields: [...ASSET_MANAGEMENT_FIELDS] }
    )
  ]
}

export function assetLifecycleCommands(entities: AssetEntities): BackendCommandDefinitionIR[] {
  return [
    ['start-asset-repair', 'available', 'repair'],
    ['complete-asset-repair', 'repair', 'available'],
    ['retire-asset', 'available', 'retired']
  ].map(([id, before, after]) =>
    businessCommand(
      id,
      id.replaceAll('-', ' '),
      assetManagerAccess(entities),
      [
        businessUUIDParameter('assetId'),
        assetVersionParameter(),
        businessStringParameter('note', 500)
      ],
      [
        readAsset(entities),
        assetVersionCheck('asset'),
        assetState(before),
        assetNonempty('note'),
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
        businessUpdate(
          entities.assets,
          'asset',
          'updated_asset',
          [{ field: 'status', value: businessLiteral(after) }, assetRevision('asset')],
          ASSET_MANAGEMENT_FIELDS
        ),
        assetHistory(entities, { action: id, assetAfter: 'updated_asset' })
      ],
      { resultName: 'updated_asset', fields: [...ASSET_MANAGEMENT_FIELDS] }
    )
  )
}
