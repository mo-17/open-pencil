import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export interface PublishingProfile {
  prefix: 'blog' | 'auto'
  authorRole: 'blog-author' | 'auto-editor'
  publisherRole: 'blog-author' | 'auto-publisher'
  roles: readonly string[]
  automotive: boolean
}

export const CATALOG_FIELDS = ['id', 'title', 'description', 'active', 'version', 'created_at']
export const MODEL_FIELDS = [...CATALOG_FIELDS, 'brand_id', 'brand_title', 'segment', 'energy_type']
export const BOOKMARK_FIELDS = ['id', 'article_id', 'active', 'version', 'created_at']
export const HISTORY_FIELDS = [
  'id',
  'article_id',
  'actor_subject',
  'action',
  'note',
  'before_status',
  'after_status',
  'created_at'
]

export function publishingArticleFields(profile: PublishingProfile): string[] {
  return [
    'id',
    'category_id',
    'category_title',
    'title',
    'summary',
    'body',
    'status',
    'published_at',
    'version',
    'created_at',
    ...(profile.automotive ? ['model_id', 'model_title', 'brand_id', 'brand_title'] : [])
  ]
}

export interface PublishingEntities {
  categories: DataEntityIR
  articles: DataEntityIR
  history: DataEntityIR
  bookmarks: DataEntityIR
  automotive?: { brands: DataEntityIR; models: DataEntityIR }
}
