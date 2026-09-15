import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import { type PublishingDomain } from './fields'

export function publishingBookmarksPage(domain: PublishingDomain): BusinessPageDefinition {
  return {
    id: `${domain}-bookmarks`,
    path: domain === 'blog' ? '/blog/bookmarks' : '/automotive/bookmarks',
    title:
      domain === 'blog'
        ? t('My blog bookmarks', '我的博客收藏')
        : t('My news bookmarks', '我的资讯收藏'),
    description: t(
      'Your private bookmark stores only an article reference. Select it to read the current public article below; withdrawn content is unavailable. Removed bookmarks can be restored only while their article is published.',
      '私人收藏仅保存文章引用。选择后在下方读取当前公开文章；已撤回的内容不可读。取消的收藏仅在文章仍已发布时可恢复。'
    ),
    listing: {
      resourceId: `${domain}-bookmarks`,
      columns: [
        { field: 'article_id', label: t('Article reference', '文章编号') },
        { field: 'active', label: t('Saved', '已收藏') }
      ],
      filter: {
        field: 'active',
        choices: [
          { value: true, label: t('Saved', '已收藏') },
          { value: false, label: t('Removed', '已取消') }
        ]
      }
    },
    related: [
      {
        resourceId: `${domain}-articles`,
        foreignKey: 'id',
        selectionField: 'article_id',
        title: t('Current public article', '当前公开文章'),
        columns: [
          { field: 'title', label: t('Title', '标题') },
          { field: 'body', label: t('Article text', '文章正文'), multiline: true }
        ]
      }
    ],
    actions: [
      formAction({
        id: `cancel-${domain}-bookmark`,
        en: 'Remove bookmark',
        zh: '取消收藏',
        inputs: [],
        parameters: { bookmarkId: selectedParameter() },
        when: { field: 'active', values: [true] }
      }),
      formAction({
        id: `restore-${domain}-bookmark`,
        en: 'Restore bookmark',
        zh: '恢复收藏',
        inputs: [],
        parameters: {
          articleId: selectedParameter('article_id'),
          bookmarkId: selectedParameter()
        },
        when: { field: 'active', values: [false] }
      })
    ]
  }
}
