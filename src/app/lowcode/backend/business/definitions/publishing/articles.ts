import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import {
  publishingArticleColumns,
  publishingArticleDetails,
  publishingArticleInputs,
  publishingHistory,
  publishingNote,
  publishingStatuses,
  type PublishingDomain
} from './fields'

export function publishingPublicArticles(domain: PublishingDomain): BusinessPageDefinition {
  return {
    id: `${domain}-articles`,
    path: domain === 'blog' ? '/blog' : '/automotive/news',
    title: domain === 'blog' ? t('Read blog', '博客阅读') : t('Automotive news', '汽车资讯阅读'),
    public: true,
    description: t(
      'Search published articles and select one to read its plain text. Sign in to bookmark it. If you removed a bookmark before, restore the original in My bookmarks. Content is manually edited; no scraping, comments or live data are included.',
      '搜索已发布文章并选择阅读纯文本正文，登录后可收藏。曾取消的收藏请到本人收藏页恢复原记录。内容由人工编辑，不含抓取、评论或实时数据。'
    ),
    listing: { resourceId: `${domain}-articles`, columns: publishingArticleColumns, search: true },
    details: [
      ...publishingArticleDetails,
      ...(domain === 'auto'
        ? [
            { field: 'brand_title', label: t('Brand', '品牌') },
            { field: 'model_title', label: t('Model', '车型') }
          ]
        : [])
    ],
    actions: [
      formAction({
        id: `create-${domain}-bookmark`,
        en: 'Bookmark article',
        zh: '收藏文章',
        inputs: [],
        parameters: { articleId: selectedParameter() }
      })
    ]
  }
}

export function publishingArticleManagement(
  domain: PublishingDomain,
  publicationOnly = false
): BusinessPageDefinition {
  const blog = domain === 'blog'
  const mayWrite = !publicationOnly
  const mayPublish = blog || publicationOnly
  const selected = { articleId: selectedParameter() }
  const automotivePage = publicationOnly
    ? {
        path: '/automotive/publisher/articles',
        title: t('Publish automotive news', '汽车资讯发布'),
        description: t(
          'auto-publisher reviews all submitted drafts and publishes or withdraws them. Publishing requires an active category, model and brand. Publication is manual; there is no live vehicle pricing or automatic news feed.',
          'auto-publisher 核对所有草稿并发布或撤回。发布时分类、车型与品牌须启用。由人工发布，不提供实时车价或自动资讯源。'
        )
      }
    : {
        path: '/automotive/editor/articles',
        title: t('Edit automotive news', '汽车资讯编辑'),
        description: t(
          'auto-editor creates and edits their own drafts. Choose a model to link its brand automatically. auto-publisher handles publication and withdrawal; editing requires the article to be a draft.',
          'auto-editor 创建并编辑本人的草稿。选择车型后由服务器关联品牌。auto-publisher 负责发布和撤回，编辑时文章须处于草稿状态。'
        )
      }
  const metadata = blog
    ? {
        path: '/blog/author/articles',
        title: t('Write blog', '博客写作'),
        description: t(
          'blog-author writes and publishes their own articles. Edit drafts only; withdraw a published article before revising it. Body content is plain text, not HTML or Markdown rendering.',
          'blog-author 编写并发布本人文章。仅草稿可编辑；已发布文章需先撤回再修改。正文按纯文本展示，不执行 HTML 或渲染 Markdown。'
        )
      }
    : automotivePage
  return {
    id: publicationOnly ? 'auto-publication' : `${domain}-management-articles`,
    ...metadata,
    listing: {
      resourceId: `${domain}-management-articles`,
      columns: [...publishingArticleColumns, { field: 'status', label: t('Status', '状态') }],
      search: true,
      filter: { field: 'status', choices: publishingStatuses }
    },
    details: [
      ...publishingArticleDetails,
      { field: 'status', label: t('Status', '状态') },
      ...(blog
        ? []
        : [
            { field: 'brand_title', label: t('Brand', '品牌') },
            { field: 'model_title', label: t('Model', '车型') }
          ])
    ],
    related: [publishingHistory(domain)],
    actions: [
      ...(mayWrite
        ? [
            formAction({
              id: `create-${domain}-article`,
              en: 'Create article draft',
              zh: '创建文章草稿',
              inputs: publishingArticleInputs(domain),
              description: t(
                'Choose the current directory entries and write a draft. Summary and body may be empty while drafting; publishing requires a non-empty title and body.',
                '选择当前目录条目并填写草稿。起草时摘要和正文可留空；发布前标题与正文须非空。'
              )
            }),
            formAction({
              id: `update-${domain}-article`,
              en: 'Edit article draft',
              zh: '编辑文章草稿',
              inputs: [...publishingArticleInputs(domain, true), publishingNote()],
              parameters: selected,
              when: { field: 'status', values: ['draft'] }
            })
          ]
        : []),
      ...(mayPublish
        ? [
            formAction({
              id: `publish-${domain}-article`,
              en: 'Publish article',
              zh: '发布文章',
              inputs: [publishingNote()],
              parameters: selected,
              when: { field: 'status', values: ['draft'] },
              description: t(
                'Review the title, plain-text body and current active directory entries. Publishing makes this article publicly readable. It does not create a server-rendered SEO page.',
                '核对标题、纯文本正文和当前已启用的目录条目。发布后文章可公开读取，此操作不会生成服务端渲染的 SEO 页面。'
              )
            }),
            formAction({
              id: `unpublish-${domain}-article`,
              en: 'Withdraw article',
              zh: '撤回文章',
              inputs: [publishingNote()],
              parameters: selected,
              when: { field: 'status', values: ['published'] },
              description: t(
                'Return this article to a draft and stop new public reads, including bookmark lookups. Readers who already downloaded it may still have a copy. Publish again after editing.',
                '将文章恢复为草稿，停止后续公开读取与收藏中的查询。已下载内容的读者可能仍保留副本；编辑后需再次发布。'
              )
            })
          ]
        : [])
    ]
  }
}
