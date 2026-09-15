import {
  businessText as t,
  type BusinessChoice,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { textInput } from '../shared'

export type PublishingDomain = 'blog' | 'auto'

export const publishingActive: readonly BusinessChoice[] = [
  { value: true, label: t('Active', '启用') },
  { value: false, label: t('Inactive', '停用') }
]
export const publishingStatuses: readonly BusinessChoice[] = [
  { value: 'draft', label: t('Draft', '草稿') },
  { value: 'published', label: t('Published', '已发布') }
]
export const publishingCatalogColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Name', '名称') }
]
export const publishingArticleColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Title', '标题') },
  { field: 'category_title', label: t('Category', '分类') }
]
export const publishingArticleDetails: readonly BusinessColumn[] = [
  ...publishingArticleColumns,
  { field: 'summary', label: t('Summary', '摘要'), multiline: true },
  { field: 'body', label: t('Article text', '文章正文'), multiline: true },
  { field: 'published_at', label: t('Published at', '发布时间') }
]
export const publishingNote = (): BusinessInput => ({
  ...textInput('note', 'Editorial note', '编辑说明', 500),
  required: false
})

export function publishingActiveInput(edit = false): BusinessInput {
  return {
    key: 'active',
    label: t('Availability', '是否启用'),
    kind: 'select',
    choices: publishingActive,
    ...(edit ? { fromSelection: 'active' } : {})
  }
}

export function publishingCatalogInputs(edit = false): BusinessInput[] {
  return [
    {
      ...textInput('title', 'Name', '名称', 100),
      ...(edit ? { fromSelection: 'title' } : {})
    },
    {
      ...textInput('description', 'Description', '说明', 1000),
      required: false,
      ...(edit ? { fromSelection: 'description' } : {})
    },
    publishingActiveInput(edit)
  ]
}

export function publishingArticleInputs(domain: PublishingDomain, edit = false): BusinessInput[] {
  const fields: BusinessInput[] = [
    {
      key: 'categoryId',
      label: t('Active category', '启用的分类'),
      kind: 'relation',
      relation: { resourceId: `${domain}-categories`, labelField: 'title' }
    },
    ...(domain === 'auto'
      ? [
          {
            key: 'modelId',
            label: t('Active vehicle model', '启用的车型'),
            kind: 'relation' as const,
            relation: {
              resourceId: 'auto-models',
              labelField: 'title',
              columns: [
                { field: 'title', label: t('Model', '车型') },
                { field: 'brand_title', label: t('Brand', '品牌') }
              ]
            }
          }
        ]
      : []),
    textInput('title', 'Title', '标题', 200),
    { ...textInput('summary', 'Summary', '摘要', 500), required: false },
    { ...textInput('body', 'Article text', '文章正文', 8192), required: false }
  ]
  const names: Record<string, string> = { categoryId: 'category_id', modelId: 'model_id' }
  return edit
    ? fields.map((field) => ({ ...field, fromSelection: names[field.key] ?? field.key }))
    : fields
}

export function publishingHistory(domain: PublishingDomain) {
  return {
    resourceId: `${domain}-article-history`,
    foreignKey: 'article_id',
    title: t('Editorial history', '编辑操作记录'),
    columns: [
      { field: 'action', label: t('Action', '操作') },
      { field: 'before_status', label: t('Previous status', '原状态') },
      { field: 'after_status', label: t('New status', '新状态') },
      { field: 'note', label: t('Editorial note', '编辑说明') },
      { field: 'created_at', label: t('Recorded at', '记录时间') }
    ]
  }
}
