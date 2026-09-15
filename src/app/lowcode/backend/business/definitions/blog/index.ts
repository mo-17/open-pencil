import { BLOG_ROLES } from '@/app/lowcode/backend/business/model/blog/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { publishingArticleManagement, publishingPublicArticles } from '../publishing/articles'
import { publishingBookmarksPage } from '../publishing/bookmarks'
import { publishingCatalogManagement, publishingCatalogPage } from '../publishing/catalog'
import { publishingArticleColumns } from '../publishing/fields'
import { accountSetupPage } from '../shared'

export function personalBlogDefinition(): BusinessTemplateDefinition {
  return {
    id: 'personal-blog',
    title: t('Personal blog', '个人博客'),
    description: t(
      'Write plain-text drafts, manage categories, publish your own articles and keep private bookmarks. Comments, uploads and server-rendered SEO are added after export.',
      '编写纯文本草稿、管理分类、发布本人文章并保存私人收藏。评论、上传及服务端 SEO 渲染在导出后扩展。'
    ),
    entryPage: 'blog-articles',
    roles: BLOG_ROLES,
    pages: [
      accountSetupPage(BLOG_ROLES),
      publishingCatalogPage({
        id: 'blog-categories',
        path: '/blog/categories',
        title: t('Blog categories', '博客分类'),
        description: t(
          'Browse active categories and their currently published articles. Open Read blog to select and read an article in full.',
          '浏览启用的分类及其中当前已发布的文章，前往博客阅读页选择并阅读完整正文。'
        ),
        related: [
          {
            resourceId: 'blog-articles',
            foreignKey: 'category_id',
            title: t('Published articles', '已发布文章'),
            columns: publishingArticleColumns
          }
        ]
      }),
      publishingPublicArticles('blog'),
      publishingBookmarksPage('blog'),
      publishingCatalogManagement({
        id: 'blog-management-categories',
        path: '/blog/author/categories',
        title: t('Manage blog categories', '博客分类管理'),
        description: t(
          'blog-author manages the blog category directory. Disabling a category prevents new publication; withdraw existing articles separately when needed.',
          'blog-author 管理博客分类目录。停用分类会阻止新的发布；已有文章如需停止公开，请另行撤回。'
        ),
        entity: 'blog-category',
        parameter: 'categoryId'
      }),
      publishingArticleManagement('blog')
    ]
  }
}
