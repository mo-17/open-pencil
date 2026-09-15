import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import {
  communityNote,
  communityPostColumns,
  communityPostDetails,
  communityPostInputs,
  communityPostStatuses,
  communityReplyInput,
  communityReplyRelation,
  communityReviewDetails
} from './fields'

export function communityPublicPage(): BusinessPageDefinition {
  return {
    id: 'community-posts',
    path: '/community',
    public: true,
    title: t('Community forum', '社区论坛'),
    description: t(
      'Read approved plain-text posts and replies. Closed discussions remain readable. Sign in and open Participate to reply, privately follow a post or report it.',
      '阅读审核通过的纯文本帖子与回复，已关闭讨论仍可阅读。登录后前往参与讨论页回复、私人关注或举报帖子。'
    ),
    listing: { resourceId: 'community-posts', columns: communityPostColumns, search: true },
    details: communityPostDetails,
    related: [communityReplyRelation()],
    actions: []
  }
}
export function communityOwnPosts(): BusinessPageDefinition {
  return {
    id: 'community-my-posts',
    path: '/community/mine/posts',
    title: t('My posts', '我的帖子'),
    description: t(
      'Signed-in members submit posts for review. Edit pending or returned posts to request another review. Published and closed posts cannot be edited; there is no delete or unpublish action in this preset.',
      '登录成员提交帖子后等待审核，待审或退回帖子可编辑并重新送审。已发布或已关闭帖子不可编辑；首版不提供删除或撤下帖子。'
    ),
    listing: {
      resourceId: 'community-my-posts',
      columns: communityPostColumns,
      search: true,
      filter: { field: 'status', choices: communityPostStatuses }
    },
    details: [...communityPostDetails, ...communityReviewDetails],
    actions: [
      formAction({
        id: 'create-community-post',
        en: 'Submit new post',
        zh: '提交新帖子',
        inputs: communityPostInputs()
      }),
      formAction({
        id: 'update-community-post',
        en: 'Edit and resubmit',
        zh: '编辑并重新送审',
        inputs: communityPostInputs(true),
        parameters: { postId: selectedParameter(), expectedVersion: selectedParameter('version') },
        when: { field: 'status', values: ['pending', 'rejected'] }
      })
    ]
  }
}
export function communityParticipation(): BusinessPageDefinition {
  return {
    id: 'community-participate',
    path: '/community/participate',
    title: t('Participate', '参与讨论'),
    description: t(
      'Select an approved post. Replies need moderator approval and can only be submitted while discussion is open. Follows and reports are private; following does not send notifications. Closed posts may still be followed or reported.',
      '选择已审核帖子。回复需管理员审核，只有开放讨论接受新的回复。关注与举报保持私密，关注不会发送通知；关闭的帖子仍可关注或举报。'
    ),
    listing: { resourceId: 'community-posts', columns: communityPostColumns, search: true },
    details: communityPostDetails,
    related: [communityReplyRelation()],
    actions: [
      formAction({
        id: 'create-community-reply',
        en: 'Submit reply for review',
        zh: '提交回复待审核',
        inputs: [communityReplyInput()],
        parameters: { postId: selectedParameter() },
        when: { field: 'status', values: ['published'] }
      }),
      formAction({
        id: 'create-community-follow',
        en: 'Follow privately',
        zh: '私人关注',
        inputs: [],
        parameters: { postId: selectedParameter() },
        description: t(
          'One follow record per account and post. To follow again after cancelling, restore the original record from My follows.',
          '每账号每帖子保留一条关注记录，取消后请从我的关注恢复原记录。'
        )
      }),
      formAction({
        id: 'create-community-report',
        en: 'Report post privately',
        zh: '私密举报帖子',
        inputs: [
          { key: 'reason', kind: 'textarea', maxLength: 2000, label: t('Reason', '举报原因') }
        ],
        parameters: { postId: selectedParameter() }
      })
    ]
  }
}
export function communityPostModeration(): BusinessPageDefinition {
  return {
    id: 'community-management-posts',
    path: '/community/moderation/posts',
    title: t('Review posts', '帖子审核'),
    description: t(
      'community-moderator approves or returns pending posts. Closing an approved post only stops new replies; it does not hide its content or existing approved replies. Review notes are visible only to the author and moderators. Content takedown, audit history and cascading deletion require development after export.',
      'community-moderator 审核通过或退回待审帖子。关闭已发布帖子仅阻止新回复，不会隐藏正文与已有公开回复。审核说明仅作者和管理员可见，内容下架、完整审核历史及级联删除需导出后开发。'
    ),
    listing: {
      resourceId: 'community-management-posts',
      columns: communityPostColumns,
      search: true,
      filter: { field: 'status', choices: communityPostStatuses }
    },
    details: [...communityPostDetails, ...communityReviewDetails],
    actions: [
      { id: 'publish-community-post', en: 'Approve post', zh: '审核通过', statuses: ['pending'] },
      { id: 'reject-community-post', en: 'Return post', zh: '退回帖子', statuses: ['pending'] },
      {
        id: 'close-community-post',
        en: 'Close discussion',
        zh: '关闭讨论',
        statuses: ['published']
      }
    ].map((action) =>
      formAction({
        ...action,
        inputs: [communityNote()],
        parameters: { postId: selectedParameter(), expectedVersion: selectedParameter('version') },
        when: { field: 'status', values: action.statuses }
      })
    )
  }
}
