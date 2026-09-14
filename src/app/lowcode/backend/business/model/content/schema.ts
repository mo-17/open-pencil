import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'

export const CONTENT_ROLES = ['content-author', 'content-reviewer', 'content-publisher'] as const
export const ARTICLE_FIELDS = [
  'id',
  'title',
  'body',
  'category',
  'status',
  'visibility',
  'published_at',
  'created_at'
]
export const PUBLISHED_ARTICLE_FIELDS = [
  'id',
  'title',
  'body',
  'category',
  'published_at',
  'created_at'
]
export const ARTICLE_HISTORY_FIELDS = [
  'id',
  'article_id',
  'actor_id',
  'event',
  'note',
  'created_at'
]

export interface ContentModel {
  articles: DataEntityIR
  history: DataEntityIR
  authorPolicy: string
  reviewerPolicy: string
  publisherPolicy: string
}

/** Reading published content is a server policy, independent of client filters and page visibility. */
export function addContentSchema(application: BackendApplicationSpecV1): ContentModel {
  addBusinessUsers(application, ['content-reviewer', 'content-publisher'])
  businessEnum(application, 'article-status', ['draft', 'in_review', 'approved', 'published'])
  businessEnum(application, 'article-visibility', ['public', 'internal'])
  businessEnum(application, 'article-event', [
    'created',
    'edited',
    'submitted',
    'approved',
    'rejected',
    'published',
    'unpublished'
  ])
  const articles = addBusinessEntity(application, 'articles', [
    businessField('title', 'string'),
    businessField('body', 'string'),
    businessField('category', 'string'),
    businessEnumField('status', 'article-status', 'draft'),
    businessEnumField('visibility', 'article-visibility', 'internal'),
    businessField('published_at', 'datetime', null, true)
  ])
  articles.indexes?.push({
    id: 'publication-state',
    fields: ['status', 'visibility', 'created_at', 'id'],
    order: 'desc'
  })
  const history = addBusinessEntity(application, 'article_history', [
    businessField('article_id', 'uuid'),
    businessField('actor_id', 'uuid'),
    businessEnumField('event', 'article-event', 'created'),
    businessField('note', 'string', '')
  ])
  linkBusinessOwner(history, 'article_id', articles)
  history.indexes?.push({
    id: 'article-history',
    fields: ['article_id', 'created_at', 'id'],
    order: 'desc'
  })

  const authorPolicy = businessOwnerGrant(application, articles)
  const reviewerPolicy = businessGrant(application, articles, 'article-reviewer', {
    kind: 'role',
    roleId: 'content-reviewer'
  })
  const publisherPolicy = businessGrant(application, articles, 'article-publisher', {
    kind: 'role',
    roleId: 'content-publisher'
  })
  const editable = businessReadResource(application, articles, 'articles', ARTICLE_FIELDS, [
    authorPolicy,
    reviewerPolicy,
    publisherPolicy
  ])
  editable.query = {
    filterFields: ['status', 'category', 'visibility'],
    searchFields: ['title', 'body', 'category'],
    sortFields: ['created_at']
  }

  for (const [id, principal, conditions] of [
    [
      'published-articles',
      { kind: 'anonymous' },
      [
        { fieldId: 'status', value: 'published' },
        { fieldId: 'visibility', value: 'public' }
      ]
    ],
    ['internal-articles', { kind: 'authenticated' }, [{ fieldId: 'status', value: 'published' }]]
  ] as const) {
    const policy = businessGrant(application, articles, id, principal)
    const declaration = application.auth.rowAccess.find((entry) => entry.id === policy)
    if (!declaration) throw new Error('Missing article publication policy.')
    declaration.conditions = conditions.map((entry) => ({ ...entry }))
    const resource = businessReadResource(application, articles, id, PUBLISHED_ARTICLE_FIELDS, [
      policy
    ])
    resource.query = {
      filterFields: ['category'],
      searchFields: ['title', 'body', 'category'],
      sortFields: ['created_at']
    }
  }
  const historyPolicies = [businessOwnerGrant(application, history)]
  for (const roleId of ['content-reviewer', 'content-publisher'])
    historyPolicies.push(
      businessGrant(application, history, roleId + '-history', { kind: 'role', roleId })
    )
  const historyResource = businessReadResource(
    application,
    history,
    'article-history',
    ARTICLE_HISTORY_FIELDS,
    historyPolicies
  )
  historyResource.query = {
    filterFields: ['article_id', 'event'],
    searchFields: [],
    sortFields: ['created_at']
  }
  return { articles, history, authorPolicy, reviewerPolicy, publisherPolicy }
}
