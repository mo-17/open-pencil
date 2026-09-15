import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const COMMUNITY_ROLES = ['community-moderator'] as const
export const COMMUNITY_POST_FIELDS = ['id', 'title', 'body', 'status', 'version', 'created_at']
export const COMMUNITY_REPLY_FIELDS = ['id', 'post_id', 'body', 'status', 'version', 'created_at']
export const COMMUNITY_MODERATION_FIELDS = ['moderation_note', 'reviewed_at']
export const COMMUNITY_FOLLOW_FIELDS = ['id', 'post_id', 'active', 'created_at']
export const COMMUNITY_REPORT_FIELDS = [
  'id',
  'post_id',
  'reason',
  'status',
  'resolution',
  'resolved_at',
  'resolved_by',
  'created_at'
]
export interface CommunityEntities {
  posts: DataEntityIR
  replies: DataEntityIR
  follows: DataEntityIR
  reports: DataEntityIR
}
