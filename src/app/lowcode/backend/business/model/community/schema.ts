import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import { addBusinessEntity, businessEnum, businessEnumField, businessField } from '../entities'
import { addCommunityPermissions } from './permissions'

function indexPost(entity: DataEntityIR): void {
  // A post is conditionally public and may belong to another account. Fixed
  // commands lock and authorize this reference; no post deletion is emitted.
  entity.indexes?.push({
    id: 'post-created',
    fields: ['post_id', 'created_at', 'id'],
    order: 'desc'
  })
}
export function createCommunityEntities(application: BackendApplicationSpecV1) {
  addBusinessUsers(application, [])
  businessEnum(application, 'community-post-status', ['pending', 'rejected', 'published', 'closed'])
  businessEnum(application, 'community-reply-status', ['pending', 'published', 'removed'])
  businessEnum(application, 'community-report-status', ['open', 'resolved'])
  const moderation = () => [
    businessField('version', 'integer', 0),
    businessField('moderation_note', 'string', ''),
    businessField('reviewed_at', 'datetime', null, true)
  ]
  const posts = addBusinessEntity(application, 'community_posts', [
    businessField('title', 'string'),
    businessField('body', 'string'),
    businessEnumField('status', 'community-post-status', 'pending'),
    ...moderation()
  ])
  const replies = addBusinessEntity(application, 'community_replies', [
    businessField('post_id', 'uuid'),
    businessField('body', 'string'),
    businessEnumField('status', 'community-reply-status', 'pending'),
    ...moderation()
  ])
  const follows = addBusinessEntity(application, 'community_follows', [
    businessField('post_id', 'uuid'),
    businessField('active', 'boolean', true)
  ])
  follows.uniques?.push({ id: 'one-follow-per-member-post', fields: ['owner_id', 'post_id'] })
  const reports = addBusinessEntity(application, 'community_reports', [
    businessField('post_id', 'uuid'),
    businessField('reason', 'string'),
    businessEnumField('status', 'community-report-status', 'open'),
    businessField('resolution', 'string', ''),
    businessField('resolved_at', 'datetime', null, true),
    businessField('resolved_by', 'uuid', null, true)
  ])
  for (const entity of [replies, follows, reports]) indexPost(entity)
  const entities = { posts, replies, follows, reports }
  addCommunityPermissions(application, entities)
  return entities
}
