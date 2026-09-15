import { AUTOMOTIVE_ROLES } from '@/app/lowcode/backend/business/model/automotive/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { publishingArticleManagement, publishingPublicArticles } from '../publishing/articles'
import { publishingBookmarksPage } from '../publishing/bookmarks'
import { publishingCatalogManagement, publishingCatalogPage } from '../publishing/catalog'
import { publishingArticleColumns } from '../publishing/fields'
import { accountSetupPage } from '../shared'
import {
  automotiveModelColumns,
  automotiveModelManagementPage,
  automotiveModelsPage
} from './models'

export function automotiveNewsDefinition(): BusinessTemplateDefinition {
  return {
    id: 'automotive-news',
    title: t('Automotive news', '汽车资讯'),
    description: t(
      'Maintain brands, models and categories; draft, review and publish plain-text news with private reader bookmarks. External feeds, prices, uploads and server-rendered SEO are added after export.',
      '维护品牌、车型及分类，起草、审核发布纯文本资讯，并提供读者私人收藏。外部资讯源、车价、上传及服务端 SEO 渲染在导出后扩展。'
    ),
    entryPage: 'auto-articles',
    roles: AUTOMOTIVE_ROLES,
    pages: [
      accountSetupPage(AUTOMOTIVE_ROLES),
      publishingCatalogPage({
        id: 'auto-categories',
        path: '/automotive/categories',
        title: t('News categories', '资讯分类'),
        description: t(
          'Browse active news categories and their published articles. Read full articles in Automotive news.',
          '浏览启用的资讯分类及已发布文章，前往汽车资讯阅读页查看完整正文。'
        ),
        related: [
          {
            resourceId: 'auto-articles',
            foreignKey: 'category_id',
            title: t('Published articles', '已发布文章'),
            columns: publishingArticleColumns
          }
        ]
      }),
      publishingCatalogPage({
        id: 'auto-brands',
        path: '/automotive/brands',
        title: t('Vehicle brands', '汽车品牌'),
        description: t(
          'Browse active brands and their active model records. All descriptions are maintained manually.',
          '浏览启用的品牌及所属的启用车型，目录说明均由人工维护。'
        ),
        related: [
          {
            resourceId: 'auto-models',
            foreignKey: 'brand_id',
            title: t('Brand models', '品牌车型'),
            columns: automotiveModelColumns
          }
        ]
      }),
      automotiveModelsPage(),
      publishingPublicArticles('auto'),
      publishingBookmarksPage('auto'),
      publishingCatalogManagement({
        id: 'auto-management-categories',
        path: '/automotive/editor/categories',
        title: t('Manage news categories', '资讯分类管理'),
        description: t(
          'auto-editor maintains news categories. Disabling a category prevents new publication; published articles must be withdrawn separately.',
          'auto-editor 维护资讯分类。停用分类会阻止新的发布；已发布文章如需停止公开，请另行撤回。'
        ),
        entity: 'auto-category',
        parameter: 'categoryId'
      }),
      publishingCatalogManagement({
        id: 'auto-management-brands',
        path: '/automotive/editor/brands',
        title: t('Manage vehicle brands', '汽车品牌管理'),
        description: t(
          'auto-editor maintains brands. Disabling a brand prevents publication for its models, but does not withdraw existing articles.',
          'auto-editor 维护品牌。停用品牌会阻止其车型资讯的新发布，但不会撤回已有文章。'
        ),
        entity: 'auto-brand',
        parameter: 'brandId'
      }),
      automotiveModelManagementPage(),
      publishingArticleManagement('auto'),
      publishingArticleManagement('auto', true)
    ]
  }
}
