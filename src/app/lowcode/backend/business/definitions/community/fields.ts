import {
  businessText as t,
  type BusinessChoice,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { textInput } from '../shared'

export const communityPostColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Post', '帖子') },
  { field: 'status', label: t('Status', '状态') }
]
export const communityPostDetails: readonly BusinessColumn[] = [
  ...communityPostColumns,
  { field: 'body', label: t('Post text', '帖子正文'), multiline: true },
  { field: 'created_at', label: t('Created at', '创建时间') }
]
export const communityReplyColumns: readonly BusinessColumn[] = [
  { field: 'post_id', label: t('Post ID', '帖子编号') },
  { field: 'status', label: t('Status', '状态') }
]
export const communityReplyDetails: readonly BusinessColumn[] = [
  ...communityReplyColumns,
  { field: 'body', label: t('Reply text', '回复正文'), multiline: true },
  { field: 'created_at', label: t('Created at', '创建时间') }
]
export const communityReviewDetails: readonly BusinessColumn[] = [
  { field: 'moderation_note', label: t('Private review note', '私人审核说明'), multiline: true },
  { field: 'reviewed_at', label: t('Reviewed at', '审核时间') }
]
export const communityPostStatuses: readonly BusinessChoice[] = [
  { value: 'pending', label: t('Pending review', '待审核') },
  { value: 'rejected', label: t('Returned for changes', '退回修改') },
  { value: 'published', label: t('Open discussion', '开放讨论') },
  { value: 'closed', label: t('Discussion closed', '讨论关闭') }
]
export const communityReplyStatuses: readonly BusinessChoice[] = [
  { value: 'pending', label: t('Pending review', '待审核') },
  { value: 'published', label: t('Published', '已发布') },
  { value: 'removed', label: t('Removed / returned', '已移除或退回') }
]
export const communityReplyRelation = () => ({
  resourceId: 'community-replies',
  foreignKey: 'post_id',
  title: t('Published replies', '已发布回复'),
  columns: communityReplyDetails
})
export const communityPostRelation = () => ({
  resourceId: 'community-posts',
  foreignKey: 'id',
  selectionField: 'post_id',
  title: t('Public post', '公开帖子'),
  columns: communityPostDetails
})
export const communityNote = (): BusinessInput => ({
  ...textInput('note', 'Review note', '审核说明', 1000),
  required: false
})
export function communityPostInputs(edit = false): BusinessInput[] {
  return [
    textInput('title', 'Post title', '帖子标题', 200),
    textInput('body', 'Post text', '帖子正文', 8192)
  ].map((field) => ({ ...field, ...(edit ? { fromSelection: field.key } : {}) }))
}
export const communityReplyInput = (edit = false): BusinessInput => ({
  ...textInput('body', 'Reply text', '回复正文', 4000),
  ...(edit ? { fromSelection: 'body' } : {})
})
