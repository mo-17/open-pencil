import {
  businessText as t,
  type BusinessColumn,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import { communityPostRelation } from './fields'

const reportColumns: readonly BusinessColumn[] = [
  { field: 'post_id', label: t('Post ID', '帖子编号') },
  { field: 'status', label: t('Status', '状态') }
]
const reportDetails: readonly BusinessColumn[] = [
  ...reportColumns,
  { field: 'reason', label: t('Report reason', '举报原因'), multiline: true },
  { field: 'resolution', label: t('Handling outcome', '处理结果'), multiline: true },
  { field: 'resolved_at', label: t('Handled at', '处理时间') },
  { field: 'resolved_by', label: t('Moderator account', '处理人账号') }
]
export function communityFollows(): BusinessPageDefinition {
  return {
    id: 'community-follows',
    path: '/community/mine/follows',
    title: t('My follows', '我的关注'),
    description: t(
      'This private list contains no copied post or reply body. Restore a cancelled follow instead of creating a duplicate. Following provides a saved list, not notifications or real-time subscriptions.',
      '此私人列表不复制帖子或回复正文，取消后可恢复原关注记录。关注只提供收藏列表，不代表消息通知或实时订阅。'
    ),
    listing: {
      resourceId: 'community-follows',
      columns: [
        { field: 'post_id', label: t('Post ID', '帖子编号') },
        { field: 'active', label: t('Following', '关注中') }
      ]
    },
    related: [communityPostRelation()],
    actions: [
      formAction({
        id: 'cancel-community-follow',
        en: 'Cancel follow',
        zh: '取消关注',
        inputs: [],
        parameters: { followId: selectedParameter() },
        when: { field: 'active', values: [true] }
      }),
      formAction({
        id: 'restore-community-follow',
        en: 'Restore follow',
        zh: '恢复关注',
        inputs: [],
        parameters: { followId: selectedParameter(), postId: selectedParameter('post_id') },
        when: { field: 'active', values: [false] }
      })
    ]
  }
}
export function communityReports(management: boolean): BusinessPageDefinition {
  return {
    id: management ? 'community-management-reports' : 'community-my-reports',
    path: management ? '/community/moderation/reports' : '/community/mine/reports',
    title: management ? t('Handle reports', '举报处理') : t('My reports', '我的举报'),
    description: management
      ? t(
          'community-moderator records a private resolution and the server records the handler and time. Resolving a report does not automatically hide or alter content; review the post or reply separately.',
          'community-moderator 记录私人处理结果，由服务器记录处理人和时间。完成举报处理不会自动隐藏或更改内容，帖子或回复需另行处理。'
        )
      : t(
          'Reports and their outcomes are visible only to the reporting account and moderators. A submitted report cannot be edited or deleted.',
          '举报及其处理结果仅举报本人和管理员可见，提交后不可编辑或删除。'
        ),
    listing: {
      resourceId: management ? 'community-management-reports' : 'community-my-reports',
      columns: reportColumns,
      filter: {
        field: 'status',
        choices: [
          { value: 'open', label: t('Awaiting handling', '待处理') },
          { value: 'resolved', label: t('Resolved', '已处理') }
        ]
      }
    },
    details: reportDetails,
    related: [communityPostRelation()],
    actions: management
      ? [
          formAction({
            id: 'resolve-community-report',
            en: 'Record report outcome',
            zh: '记录举报处理结果',
            inputs: [textInput('resolution', 'Handling outcome', '处理结果', 2000)],
            parameters: { reportId: selectedParameter() },
            when: { field: 'status', values: ['open'] }
          })
        ]
      : []
  }
}
