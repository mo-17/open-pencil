import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import {
  businessGrant,
  businessOwnerGrant,
  businessPublicGrant,
  businessReadResource
} from '../permissions'
import {
  MEDIA_FAVORITE_FIELDS,
  MEDIA_ROLES,
  mediaDomain,
  type MediaEntities,
  type MediaKind
} from './fields'

export const MEDIA_CREATE_POLICIES = MEDIA_ROLES.map((role) => role + '-own-profile')
export const MEDIA_PUBLISHED_VIDEO_POLICY = 'media-published-videos'

function publicPolicy(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  id: string,
  status: string
): string {
  return businessPublicGrant(application, entity, id, [{ fieldId: 'status', value: status }])
}

function contentPermissions(
  application: BackendApplicationSpecV1,
  entities: MediaEntities,
  kind: MediaKind
): void {
  const domain = mediaDomain(entities, kind)
  const management = [
    businessOwnerGrant(application, domain.entity),
    businessGrant(application, domain.entity, `media-${kind}-admin`, {
      kind: 'role',
      roleId: 'media-admin'
    })
  ]
  const published =
    kind === 'video'
      ? [publicPolicy(application, domain.entity, MEDIA_PUBLISHED_VIDEO_POLICY, 'published')]
      : ['scheduled', 'live', 'ended'].map((status) =>
          publicPolicy(application, domain.entity, `media-${status}-channels`, status)
        )
  for (const [id, policies] of [
    [`media-${kind}s`, published],
    [`media-management-${kind}s`, management]
  ] as const) {
    const resource = businessReadResource(application, domain.entity, id, domain.fields, policies)
    resource.query = {
      filterFields:
        kind === 'channel' || policies === management ? ['category', 'status'] : ['category'],
      searchFields: ['title', 'category', 'description'],
      sortFields: ['created_at']
    }
  }
  const events = businessReadResource(
    application,
    domain.history,
    `media-${kind}-history`,
    domain.historyFields,
    [
      businessOwnerGrant(application, domain.history),
      businessGrant(application, domain.history, `media-${kind}-history-admin`, {
        kind: 'role',
        roleId: 'media-admin'
      })
    ]
  )
  events.query = {
    filterFields: [domain.parentField, 'action'],
    searchFields: [],
    sortFields: ['created_at']
  }
}

export function addMediaPermissions(
  application: BackendApplicationSpecV1,
  entities: MediaEntities
): void {
  for (const roleId of MEDIA_ROLES)
    application.auth.rowAccess.push({
      id: roleId + '-own-profile',
      entityId: entities.users.id,
      effect: 'allow',
      operations: ['select'],
      // Only create commands select these policies. Their locked profile read
      // also applies owner scope; existing account projections stay unchanged.
      principal: { kind: 'role', roleId },
      conditions: [{ fieldId: 'active', value: true }]
    })
  contentPermissions(application, entities, 'video')
  contentPermissions(application, entities, 'channel')
  const favorite = businessReadResource(
    application,
    entities.favorites,
    'media-favorites',
    MEDIA_FAVORITE_FIELDS,
    [businessOwnerGrant(application, entities.favorites)]
  )
  favorite.query = {
    filterFields: ['video_id', 'active'],
    searchFields: ['video_title'],
    sortFields: ['created_at']
  }
}
