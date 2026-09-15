import { COMMUNITY_ROLES } from '@/app/lowcode/backend/business/model/community/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import {
  communityOwnPosts,
  communityParticipation,
  communityPostModeration,
  communityPublicPage
} from './posts'
import { communityFollows, communityReports } from './private'
import { communityOwnReplies, communityReplyModeration } from './replies'

export function communityForumDefinition(): BusinessTemplateDefinition {
  return {
    id: 'community-forum',
    title: t('Community forum', '社区论坛'),
    description: t(
      'Moderated plain-text posts and replies, private follows, and private report handling. Closed discussions remain public. Accepted answers, content takedown, full audit history, notifications and real-time chat are added after export.',
      '提供纯文本帖子与回复审核、私人关注及私密举报处理。关闭讨论后内容仍公开；答案采纳、内容下架、完整审核历史、通知和实时聊天需导出后开发。'
    ),
    entryPage: 'community-posts',
    roles: COMMUNITY_ROLES,
    pages: [
      accountSetupPage(COMMUNITY_ROLES),
      communityPublicPage(),
      communityOwnPosts(),
      communityParticipation(),
      communityOwnReplies(),
      communityFollows(),
      communityReports(false),
      communityPostModeration(),
      communityReplyModeration(),
      communityReports(true)
    ]
  }
}
