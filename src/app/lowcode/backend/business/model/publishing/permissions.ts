import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'
import {
  BOOKMARK_FIELDS,
  CATALOG_FIELDS,
  HISTORY_FIELDS,
  MODEL_FIELDS,
  publishingArticleFields,
  type PublishingEntities,
  type PublishingProfile
} from './types'

function publishedGrant(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  id: string,
  fieldId: string,
  value: string | boolean
): string {
  application.auth.rowAccess.push({
    id,
    entityId: entity.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'anonymous' },
    conditions: [{ fieldId, value }]
  })
  return id
}

function catalogPermissions(
  application: BackendApplicationSpecV1,
  profile: PublishingProfile,
  entity: DataEntityIR,
  kind: string
): void {
  const fields = kind === 'models' ? MODEL_FIELDS : CATALOG_FIELDS
  const manager = profile.roles.map((roleId) =>
    businessGrant(application, entity, `${profile.prefix}-${kind}-${roleId}`, {
      kind: 'role',
      roleId
    })
  )
  const active = publishedGrant(
    application,
    entity,
    `${profile.prefix}-active-${kind}`,
    'active',
    true
  )
  for (const [id, policies] of [
    [`${profile.prefix}-${kind}`, [active]],
    [`${profile.prefix}-management-${kind}`, manager]
  ] as const) {
    const resource = businessReadResource(application, entity, id, fields, policies)
    resource.query = {
      filterFields: ['active', ...(kind === 'models' ? ['brand_id'] : [])],
      searchFields: ['title', 'description', ...(kind === 'models' ? ['brand_title'] : [])],
      sortFields: ['created_at']
    }
  }
}

export function addPublishingPermissions(
  application: BackendApplicationSpecV1,
  profile: PublishingProfile,
  entities: PublishingEntities
): void {
  catalogPermissions(application, profile, entities.categories, 'categories')
  if (entities.automotive) {
    catalogPermissions(application, profile, entities.automotive.brands, 'brands')
    catalogPermissions(application, profile, entities.automotive.models, 'models')
  }
  const { prefix } = profile
  const management = [businessOwnerGrant(application, entities.articles)]
  const historyPolicies = [businessOwnerGrant(application, entities.history)]
  if (profile.automotive) {
    management.push(
      businessGrant(application, entities.articles, `${prefix}-article-publisher`, {
        kind: 'role',
        roleId: profile.publisherRole
      })
    )
    historyPolicies.push(
      businessGrant(application, entities.history, `${prefix}-history-publisher`, {
        kind: 'role',
        roleId: profile.publisherRole
      })
    )
  }
  const published = publishedGrant(
    application,
    entities.articles,
    `${prefix}-published-articles`,
    'status',
    'published'
  )
  for (const [id, policies] of [
    [`${prefix}-articles`, [published]],
    [`${prefix}-management-articles`, management]
  ] as const) {
    const resource = businessReadResource(
      application,
      entities.articles,
      id,
      publishingArticleFields(profile),
      policies
    )
    resource.query = {
      filterFields: [
        'id',
        'category_id',
        ...(profile.automotive ? ['brand_id', 'model_id'] : []),
        ...(policies === management ? ['status'] : [])
      ],
      searchFields: [
        'title',
        'summary',
        'body',
        'category_title',
        ...(profile.automotive ? ['brand_title', 'model_title'] : [])
      ],
      sortFields: ['created_at']
    }
  }
  const history = businessReadResource(
    application,
    entities.history,
    `${prefix}-article-history`,
    HISTORY_FIELDS,
    historyPolicies
  )
  history.query = {
    filterFields: ['article_id', 'action'],
    searchFields: [],
    sortFields: ['created_at']
  }
  const bookmarks = businessReadResource(
    application,
    entities.bookmarks,
    `${prefix}-bookmarks`,
    BOOKMARK_FIELDS,
    [businessOwnerGrant(application, entities.bookmarks)]
  )
  bookmarks.query = {
    filterFields: ['article_id', 'active'],
    searchFields: [],
    sortFields: ['created_at']
  }
}
