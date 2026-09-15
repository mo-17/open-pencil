import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult
} from '../commands'
import { publicationHistoryValues } from '../publication-history'
import {
  CATALOG_FIELDS,
  HISTORY_FIELDS,
  MODEL_FIELDS,
  publishingArticleFields,
  type PublishingEntities,
  type PublishingProfile
} from './types'

export function publishingRevision(record: string): BackendCommandValueIR {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult(record, 'version'),
      right: businessLiteral(1)
    }
  }
}

export function publishingAccess(
  profile: PublishingProfile,
  entities: PublishingEntities,
  publish = false
): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.articles.id,
    parameter: 'articleId',
    policyIds: [
      publish && profile.automotive
        ? `${profile.prefix}-article-publisher`
        : `own-${profile.prefix}-articles`
    ],
    roleId: publish ? profile.publisherRole : profile.authorRole
  }
}

export function readPublishingArticle(profile: PublishingProfile, entities: PublishingEntities) {
  return businessRead(entities.articles, 'article', businessParameter('articleId'), [
    'owner_id',
    ...publishingArticleFields(profile)
  ])
}

export function publishingStatus(status: 'draft' | 'published'): BackendCommandStepIR {
  return businessAssert(
    'expected_status',
    businessResult('article', 'status'),
    businessLiteral(status)
  )
}

export function publishingHistory(
  entities: PublishingEntities,
  action: string,
  after: BackendCommandLeafIR,
  created = false
): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    'history',
    publicationHistoryValues('article', 'article_id', action, after, created),
    HISTORY_FIELDS
  )
}

/** All article commands lock category, then model, then brand after any article authority lock. */
export function publishingReferences(
  entities: PublishingEntities,
  fromArticle = false
): BackendCommandStepIR[] {
  const key = (field: string, parameter: string) =>
    fromArticle ? businessResult('article', field) : businessParameter(parameter)
  const steps = [
    businessRead(entities.categories, 'category', key('category_id', 'categoryId'), CATALOG_FIELDS),
    businessAssert('active_category', businessResult('category', 'active'), businessLiteral(true))
  ]
  if (entities.automotive) {
    steps.push(
      businessRead(entities.automotive.models, 'model', key('model_id', 'modelId'), MODEL_FIELDS),
      businessAssert('active_model', businessResult('model', 'active'), businessLiteral(true)),
      businessRead(
        entities.automotive.brands,
        'brand',
        businessResult('model', 'brand_id'),
        CATALOG_FIELDS
      ),
      businessAssert('active_brand', businessResult('brand', 'active'), businessLiteral(true))
    )
  }
  return steps
}

export function publishingReferenceValues(entities: PublishingEntities): BackendCommandValueIR[] {
  return [
    { field: 'category_id', value: businessResult('category', 'id') },
    { field: 'category_title', value: businessResult('category', 'title') },
    ...(entities.automotive
      ? [
          { field: 'model_id', value: businessResult('model', 'id') },
          { field: 'model_title', value: businessResult('model', 'title') },
          { field: 'brand_id', value: businessResult('brand', 'id') },
          { field: 'brand_title', value: businessResult('brand', 'title') }
        ]
      : [])
  ]
}
