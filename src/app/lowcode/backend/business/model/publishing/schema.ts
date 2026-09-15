import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { addPublishingPermissions } from './permissions'
import type { PublishingEntities, PublishingProfile } from './types'

function catalog(application: BackendApplicationSpecV1, name: string): DataEntityIR {
  return addBusinessEntity(application, name, [
    businessField('title', 'string'),
    businessField('description', 'string'),
    businessField('active', 'boolean', true),
    businessField('version', 'integer', 0)
  ])
}

export function createPublishingEntities(
  application: BackendApplicationSpecV1,
  profile: PublishingProfile
): PublishingEntities {
  addBusinessUsers(application, [])
  const { prefix } = profile
  const categories = catalog(application, `${prefix}_categories`)
  const automotive = profile.automotive
    ? {
        brands: catalog(application, `${prefix}_brands`),
        models: catalog(application, `${prefix}_models`)
      }
    : undefined
  automotive?.models.fields.push(
    businessField('brand_id', 'uuid'),
    ...['brand_title', 'segment', 'energy_type'].map((field) => businessField(field, 'string'))
  )
  businessEnum(application, `${prefix}-article-status`, ['draft', 'published'])
  const articles = addBusinessEntity(application, `${prefix}_articles`, [
    businessField('category_id', 'uuid'),
    ...['category_title', 'title', 'summary', 'body'].map((field) =>
      businessField(field, 'string')
    ),
    businessEnumField('status', `${prefix}-article-status`, 'draft'),
    businessField('published_at', 'datetime', null, true),
    businessField('version', 'integer', 0),
    ...(automotive
      ? [
          businessField('model_id', 'uuid'),
          businessField('brand_id', 'uuid'),
          businessField('model_title', 'string'),
          businessField('brand_title', 'string')
        ]
      : [])
  ])
  articles.indexes?.push({
    id: 'publication-category',
    fields: ['status', 'category_id', 'created_at', 'id'],
    order: 'desc'
  })
  const history = addBusinessEntity(application, `${prefix}_article_history`, [
    businessField('article_id', 'uuid'),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string'),
    businessEnumField('before_status', `${prefix}-article-status`, 'draft'),
    businessEnumField('after_status', `${prefix}-article-status`, 'draft')
  ])
  linkBusinessOwner(history, 'article_id', articles)
  history.indexes?.push({
    id: 'article-created',
    fields: ['article_id', 'created_at', 'id'],
    order: 'desc'
  })
  const bookmarks = addBusinessEntity(application, `${prefix}_bookmarks`, [
    businessField('article_id', 'uuid'),
    businessField('active', 'boolean', true),
    businessField('version', 'integer', 0)
  ])
  bookmarks.uniques?.push({ id: 'one-bookmark-per-reader', fields: ['owner_id', 'article_id'] })
  // Cross-owner catalog/content references are verified by locked commands. No
  // delete or direct CRUD route exists; conditional public reads stay narrow.
  // Bookmarks intentionally retain no title, body, URL or other content snapshot.
  const entities = {
    categories,
    articles,
    history,
    bookmarks,
    ...(automotive ? { automotive } : {})
  }
  addPublishingPermissions(application, profile, entities)
  return entities
}
