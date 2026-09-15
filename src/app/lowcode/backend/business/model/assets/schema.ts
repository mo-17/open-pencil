import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import { addBusinessEntity, businessEnum, businessEnumField, businessField } from '../entities'
import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'
import {
  ASSET_FIELDS,
  ASSET_HISTORY_FIELDS,
  ASSET_MANAGEMENT_FIELDS,
  ASSET_REQUEST_FIELDS,
  ASSET_REQUEST_STATUSES,
  ASSET_STATUSES,
  type AssetEntities
} from './fields'

function permissions(application: BackendApplicationSpecV1, entities: AssetEntities): void {
  businessGrant(application, entities.assets, 'manage-assets', {
    kind: 'role',
    roleId: 'asset-manager'
  })
  businessGrant(application, entities.requests, 'manage-asset-requests', {
    kind: 'role',
    roleId: 'asset-manager'
  })
  businessGrant(application, entities.history, 'manage-asset-history', {
    kind: 'role',
    roleId: 'asset-manager'
  })
  businessOwnerGrant(application, entities.requests)
  application.auth.rowAccess.push({
    id: 'available-assets',
    entityId: entities.assets.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'authenticated' },
    conditions: [{ fieldId: 'status', value: 'available' }]
  })
  for (const [entity, id, fields, policies, filterFields, searchFields] of [
    [
      entities.assets,
      'assets',
      ASSET_FIELDS,
      ['available-assets'],
      ['id', 'category'],
      ['tag', 'title', 'category']
    ],
    [
      entities.assets,
      'asset-management',
      ASSET_MANAGEMENT_FIELDS,
      ['manage-assets'],
      ['id', 'status', 'category'],
      ['tag', 'title', 'category']
    ],
    [
      entities.requests,
      'asset-requests',
      ASSET_REQUEST_FIELDS,
      ['own-asset-requests'],
      ['asset_id', 'status', 'kind'],
      ['asset_tag', 'asset_title']
    ],
    [
      entities.requests,
      'asset-management-requests',
      ASSET_REQUEST_FIELDS,
      ['manage-asset-requests'],
      ['asset_id', 'status', 'kind'],
      ['asset_tag', 'asset_title', 'borrower_name']
    ],
    [
      entities.history,
      'asset-history',
      ASSET_HISTORY_FIELDS,
      ['manage-asset-history'],
      ['asset_id', 'request_id', 'action'],
      []
    ]
  ] as const) {
    const resource = businessReadResource(application, entity, id, fields, policies)
    resource.query = {
      filterFields: [...filterFields],
      searchFields: [...searchFields],
      sortFields: ['created_at']
    }
  }
}

export function createAssetEntities(application: BackendApplicationSpecV1): AssetEntities {
  addBusinessUsers(application, [])
  businessEnum(application, 'asset-status', ASSET_STATUSES)
  businessEnum(application, 'asset-request-status', ASSET_REQUEST_STATUSES)
  businessEnum(application, 'asset-request-kind', ['assignment', 'loan'])
  const assets = addBusinessEntity(application, 'assets', [
    ...['tag', 'title', 'category', 'location', 'description'].map((field) =>
      businessField(field, 'string')
    ),
    businessField('registered_by', 'uuid'),
    businessField('custodian_subject', 'uuid', null, true),
    businessField('current_request_id', 'uuid', null, true),
    businessEnumField('status', 'asset-status', 'available'),
    businessField('version', 'integer', 0)
  ])
  assets.uniques?.push({ id: 'unique-asset-tag', fields: ['tag'] })
  const requests = addBusinessEntity(application, 'asset_requests', [
    businessField('asset_id', 'uuid'),
    ...['asset_tag', 'asset_title', 'borrower_name', 'purpose'].map((field) =>
      businessField(field, 'string')
    ),
    businessEnumField('kind', 'asset-request-kind', 'assignment'),
    businessEnumField('status', 'asset-request-status', 'requested'),
    businessField('due_at', 'datetime', null, true),
    businessField('issued_at', 'datetime', null, true),
    businessField('returned_at', 'datetime', null, true),
    businessField('fulfillment_note', 'string', ''),
    businessField('version', 'integer', 0)
  ])
  const history = addBusinessEntity(application, 'asset_history', [
    businessField('asset_id', 'uuid'),
    businessField('request_id', 'uuid', null, true),
    businessField('actor_subject', 'uuid'),
    ...['action', 'note', 'before_request_status', 'after_request_status'].map((field) =>
      businessField(field, 'string')
    ),
    businessEnumField('before_status', 'asset-status', 'available'),
    businessEnumField('after_status', 'asset-status', 'available'),
    ...['before_version', 'after_version', 'request_version'].map((field) =>
      businessField(field, 'integer')
    )
  ])
  for (const entity of [requests, history])
    entity.indexes?.push({
      id: 'asset-created',
      fields: ['asset_id', 'created_at', 'id'],
      order: 'desc'
    })
  // Organization managers register assets; borrowers own requests; audit rows belong
  // to the actor. Locked commands maintain these cross-owner references and no delete
  // or direct mutation route exists. Asset owner and current custodian are distinct.
  const entities = { assets, requests, history }
  permissions(application, entities)
  return entities
}
