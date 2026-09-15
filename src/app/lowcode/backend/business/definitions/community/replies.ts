import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import {
  communityNote,
  communityPostRelation,
  communityReplyColumns,
  communityReplyDetails,
  communityReplyInput,
  communityReplyStatuses,
  communityReviewDetails
} from './fields'

export function communityOwnReplies(): BusinessPageDefinition {
  return {
    id: 'community-my-replies',
    path: '/community/mine/replies',
    title: t('My replies', '我的回复'),
    description: t(
      'Only your own replies and review notes appear here. Pending or removed replies may be edited and resubmitted while the parent discussion is open. Published replies cannot be edited.',
      '这里只显示本人回复及审核说明。原帖讨论开放时，待审或移除回复可编辑并重新送审，已公开回复不可编辑。'
    ),
    listing: {
      resourceId: 'community-my-replies',
      columns: communityReplyColumns,
      filter: { field: 'status', choices: communityReplyStatuses }
    },
    details: [...communityReplyDetails, ...communityReviewDetails],
    related: [communityPostRelation()],
    actions: [
      formAction({
        id: 'update-community-reply',
        en: 'Edit and resubmit reply',
        zh: '编辑回复并重新送审',
        inputs: [communityReplyInput(true)],
        parameters: {
          postId: selectedParameter('post_id'),
          replyId: selectedParameter(),
          expectedVersion: selectedParameter('version')
        },
        when: { field: 'status', values: ['pending', 'removed'] }
      })
    ]
  }
}
export function communityReplyModeration(): BusinessPageDefinition {
  return {
    id: 'community-management-replies',
    path: '/community/moderation/replies',
    title: t('Review replies', '回复审核'),
    description: t(
      'community-moderator approves pending replies or removes pending and published replies. Earlier pending replies can still be reviewed after discussion closes. Removed reply bodies stay private to their author and moderators.',
      'community-moderator 可通过待审回复，或移除待审及已公开回复。讨论关闭后仍可审核此前的待审回复；移除后的正文仅作者和管理员可见。'
    ),
    listing: {
      resourceId: 'community-management-replies',
      columns: communityReplyColumns,
      filter: { field: 'status', choices: communityReplyStatuses }
    },
    details: [...communityReplyDetails, ...communityReviewDetails],
    related: [communityPostRelation()],
    actions: [
      { id: 'publish-community-reply', en: 'Approve reply', zh: '通过回复', statuses: ['pending'] },
      {
        id: 'remove-community-reply',
        en: 'Remove or return reply',
        zh: '移除或退回回复',
        statuses: ['pending', 'published']
      }
    ].map((action) =>
      formAction({
        ...action,
        inputs: [communityNote()],
        parameters: {
          postId: selectedParameter('post_id'),
          replyId: selectedParameter(),
          expectedVersion: selectedParameter('version')
        },
        when: { field: 'status', values: action.statuses }
      })
    )
  }
}
