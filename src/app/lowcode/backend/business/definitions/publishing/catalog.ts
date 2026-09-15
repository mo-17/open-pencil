import {
  businessText as t,
  type BusinessPageDefinition,
  type BusinessText
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import { publishingActive, publishingCatalogColumns, publishingCatalogInputs } from './fields'

export function publishingCatalogPage(options: {
  id: string
  path: string
  title: BusinessText
  description: BusinessText
  related: NonNullable<BusinessPageDefinition['related']>
}): BusinessPageDefinition {
  return {
    ...options,
    public: true,
    listing: { resourceId: options.id, columns: publishingCatalogColumns, search: true },
    details: [
      ...publishingCatalogColumns,
      { field: 'description', label: t('Description', '说明'), multiline: true }
    ],
    actions: []
  }
}

export function publishingCatalogManagement(options: {
  id: string
  path: string
  title: BusinessText
  description: BusinessText
  entity: 'blog-category' | 'auto-category' | 'auto-brand'
  parameter: 'categoryId' | 'brandId'
}): BusinessPageDefinition {
  return {
    id: options.id,
    path: options.path,
    title: options.title,
    description: options.description,
    listing: {
      resourceId: options.id,
      columns: [...publishingCatalogColumns, { field: 'active', label: t('Active', '启用') }],
      search: true,
      filter: { field: 'active', choices: publishingActive }
    },
    details: [
      ...publishingCatalogColumns,
      { field: 'description', label: t('Description', '说明'), multiline: true },
      { field: 'active', label: t('Active', '启用') }
    ],
    actions: [
      formAction({
        id: `create-${options.entity}`,
        en: 'Create entry',
        zh: '新增条目',
        inputs: publishingCatalogInputs()
      }),
      formAction({
        id: `update-${options.entity}`,
        en: 'Edit entry',
        zh: '编辑条目',
        inputs: publishingCatalogInputs(true),
        parameters: { [options.parameter]: selectedParameter() },
        description: t(
          'Changes affect this directory. Existing articles keep their saved labels. To remove a published article from public reading, withdraw that article separately.',
          '修改此目录条目。已有文章保留保存时的名称；如需停止公开某篇文章，请另行撤回该文章。'
        )
      })
    ]
  }
}
