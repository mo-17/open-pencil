import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import type { MediaEntities, MediaKind } from './fields'
import { addMediaPermissions } from './permissions'

function content(application: BackendApplicationSpecV1, kind: MediaKind): DataEntityIR {
  const entity = addBusinessEntity(application, `media_${kind}s`, [
    ...['title', 'category', 'description', 'playback_url', 'poster_url'].map((field) =>
      businessField(field, 'string')
    ),
    businessEnumField('status', `media-${kind}-status`, 'draft'),
    businessField('version', 'integer', 0),
    ...(kind === 'channel' ? [businessField('scheduled_at', 'datetime', null, true)] : [])
  ])
  entity.indexes?.push({
    id: 'publication-category',
    fields: ['status', 'category', 'created_at', 'id'],
    order: 'desc'
  })
  return entity
}

function history(
  application: BackendApplicationSpecV1,
  kind: MediaKind,
  parent: DataEntityIR
): DataEntityIR {
  const entity = addBusinessEntity(application, `media_${kind}_history`, [
    businessField(`${kind}_id`, 'uuid'),
    businessField('actor_subject', 'uuid'),
    ...['action', 'note'].map((field) => businessField(field, 'string')),
    businessEnumField('before_status', `media-${kind}-status`, 'draft'),
    businessEnumField('after_status', `media-${kind}-status`, 'draft')
  ])
  linkBusinessOwner(entity, `${kind}_id`, parent)
  entity.indexes?.push({
    id: 'parent-created',
    fields: [`${kind}_id`, 'created_at', 'id'],
    order: 'desc'
  })
  return entity
}

export function createMediaEntities(application: BackendApplicationSpecV1): MediaEntities {
  const users = addBusinessUsers(application, ['media-admin'])
  businessEnum(application, 'media-video-status', ['draft', 'published', 'archived'])
  businessEnum(application, 'media-channel-status', [
    'draft',
    'scheduled',
    'live',
    'ended',
    'archived'
  ])
  const videos = content(application, 'video')
  const channels = content(application, 'channel')
  const videoHistory = history(application, 'video', videos)
  const channelHistory = history(application, 'channel', channels)
  const favorites = addBusinessEntity(application, 'media_favorites', [
    businessField('video_id', 'uuid'),
    businessField('video_title', 'string'),
    businessField('active', 'boolean', true),
    businessField('version', 'integer', 0)
  ])
  // Cross-owner references to conditionally public content are maintained by the
  // locked create/restore commands. There is no direct CRUD or video delete route.
  // A physical FK would require weakening the provider's public-read boundary.
  favorites.uniques?.push({ id: 'one-favorite-per-viewer', fields: ['owner_id', 'video_id'] })
  const entities = { users, videos, channels, videoHistory, channelHistory, favorites }
  addMediaPermissions(application, entities)
  return entities
}
