import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import {
  businessGrant,
  businessOwnerGrant,
  businessPublicGrant,
  businessReadResource
} from '../permissions'
import {
  COMMUNITY_FOLLOW_FIELDS,
  COMMUNITY_MODERATION_FIELDS,
  COMMUNITY_POST_FIELDS,
  COMMUNITY_REPLY_FIELDS,
  COMMUNITY_REPORT_FIELDS,
  type CommunityEntities
} from './fields'

function published(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  status: string
): string {
  const id = `${entity.name.replaceAll('_', '-')}-${status}`
  return businessPublicGrant(application, entity, id, [{ fieldId: 'status', value: status }])
}
function privateResources(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  name: string,
  fields: readonly string[],
  filters: string[],
  search: string[] = []
): void {
  for (const [id, policy] of [
    [`community-my-${name}`, businessOwnerGrant(application, entity)],
    [
      `community-management-${name}`,
      businessGrant(application, entity, `manage-community-${name}`, {
        kind: 'role',
        roleId: 'community-moderator'
      })
    ]
  ]) {
    const resource = businessReadResource(application, entity, id, fields, [policy])
    resource.query = { filterFields: filters, searchFields: search, sortFields: ['created_at'] }
  }
}
export function addCommunityPermissions(
  application: BackendApplicationSpecV1,
  entities: CommunityEntities
): void {
  const posts = businessReadResource(
    application,
    entities.posts,
    'community-posts',
    COMMUNITY_POST_FIELDS,
    [
      published(application, entities.posts, 'published'),
      published(application, entities.posts, 'closed')
    ]
  )
  posts.query = {
    filterFields: ['id', 'status'],
    searchFields: ['title', 'body'],
    sortFields: ['created_at']
  }
  const replies = businessReadResource(
    application,
    entities.replies,
    'community-replies',
    COMMUNITY_REPLY_FIELDS,
    [published(application, entities.replies, 'published')]
  )
  replies.query = { filterFields: ['post_id'], searchFields: [], sortFields: ['created_at'] }
  privateResources(
    application,
    entities.posts,
    'posts',
    [...COMMUNITY_POST_FIELDS, ...COMMUNITY_MODERATION_FIELDS],
    ['status'],
    ['title', 'body']
  )
  privateResources(
    application,
    entities.replies,
    'replies',
    [...COMMUNITY_REPLY_FIELDS, ...COMMUNITY_MODERATION_FIELDS],
    ['post_id', 'status']
  )
  privateResources(application, entities.reports, 'reports', COMMUNITY_REPORT_FIELDS, [
    'post_id',
    'status'
  ])
  const follows = businessReadResource(
    application,
    entities.follows,
    'community-follows',
    COMMUNITY_FOLLOW_FIELDS,
    [businessOwnerGrant(application, entities.follows)]
  )
  follows.query = {
    filterFields: ['post_id', 'active'],
    searchFields: [],
    sortFields: ['created_at']
  }
}
