import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const MEDIA_ROLES = ['media-creator', 'media-admin'] as const
export const MEDIA_FIELDS = [
  'id',
  'title',
  'category',
  'description',
  'playback_url',
  'poster_url',
  'status',
  'version',
  'created_at'
]
export const MEDIA_VIDEO_FIELDS = [...MEDIA_FIELDS]
export const MEDIA_CHANNEL_FIELDS = [...MEDIA_FIELDS, 'scheduled_at']
export const MEDIA_FAVORITE_FIELDS = [
  'id',
  'video_id',
  'video_title',
  'active',
  'version',
  'created_at'
]
const HISTORY_FIELDS = [
  'id',
  'actor_subject',
  'action',
  'note',
  'before_status',
  'after_status',
  'created_at'
]
export const MEDIA_VIDEO_HISTORY_FIELDS = [...HISTORY_FIELDS, 'video_id']
export const MEDIA_CHANNEL_HISTORY_FIELDS = [...HISTORY_FIELDS, 'channel_id']

export interface MediaEntities {
  users: DataEntityIR
  videos: DataEntityIR
  channels: DataEntityIR
  videoHistory: DataEntityIR
  channelHistory: DataEntityIR
  favorites: DataEntityIR
}

export type MediaKind = 'video' | 'channel'

export function mediaDomain(entities: MediaEntities, kind: MediaKind) {
  return {
    kind,
    entity: kind === 'video' ? entities.videos : entities.channels,
    history: kind === 'video' ? entities.videoHistory : entities.channelHistory,
    fields: kind === 'video' ? MEDIA_VIDEO_FIELDS : MEDIA_CHANNEL_FIELDS,
    historyFields: kind === 'video' ? MEDIA_VIDEO_HISTORY_FIELDS : MEDIA_CHANNEL_HISTORY_FIELDS,
    parameter: `${kind}Id`,
    parentField: `${kind}_id`,
    managementPolicies: [`own-media-${kind}s`, `media-${kind}-admin`]
  }
}

export type MediaDomain = ReturnType<typeof mediaDomain>
