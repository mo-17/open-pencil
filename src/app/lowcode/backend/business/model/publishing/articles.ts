import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import {
  publishingAccess,
  publishingHistory,
  publishingReferences,
  publishingReferenceValues,
  publishingRevision,
  publishingStatus,
  readPublishingArticle
} from './steps'
import { publishingArticleFields, type PublishingEntities, type PublishingProfile } from './types'

function parameters(profile: PublishingProfile): BackendCommandParameterIR[] {
  return [
    businessUUIDParameter('categoryId'),
    ...(profile.automotive ? [businessUUIDParameter('modelId')] : []),
    businessStringParameter('title', 200),
    businessStringParameter('summary', 500),
    businessStringParameter('body', 8192)
  ]
}

const values = (): BackendCommandValueIR[] =>
  ['title', 'summary', 'body'].map((field) => ({ field, value: businessParameter(field) }))

function transition(
  profile: PublishingProfile,
  entities: PublishingEntities,
  publish: boolean
): BackendCommandDefinitionIR {
  const fields = publishingArticleFields(profile)
  const status = publish ? 'published' : 'draft'
  return businessCommand(
    `${publish ? 'publish' : 'unpublish'}-${profile.prefix}-article`,
    `${publish ? 'Publish' : 'Withdraw'} ${profile.prefix} article`,
    publishingAccess(profile, entities, true),
    [businessUUIDParameter('articleId'), businessStringParameter('note', 500)],
    [
      readPublishingArticle(profile, entities),
      publishingStatus(publish ? 'draft' : 'published'),
      ...(publish
        ? [
            ...publishingReferences(entities, true),
            ...['title', 'body'].map((field) =>
              businessAssert(
                `nonempty_${field}`,
                businessResult('article', field),
                businessLiteral(''),
                'neq'
              )
            )
          ]
        : []),
      businessUpdate(
        entities.articles,
        'article',
        'updated',
        [
          { field: 'status', value: businessLiteral(status) },
          {
            field: 'published_at',
            value: publish ? { kind: 'server-now' } : businessLiteral(null)
          },
          ...(publish ? publishingReferenceValues(entities) : []),
          publishingRevision('article')
        ],
        fields
      ),
      publishingHistory(entities, publish ? 'published' : 'unpublished', businessLiteral(status))
    ],
    { resultName: 'updated', fields }
  )
}

export function publishingArticleCommands(
  profile: PublishingProfile,
  entities: PublishingEntities
): BackendCommandDefinitionIR[] {
  const fields = publishingArticleFields(profile)
  return [
    businessCommand(
      `create-${profile.prefix}-article`,
      `Create my ${profile.prefix} article draft`,
      { kind: 'role', roleId: profile.authorRole },
      parameters(profile),
      [
        ...publishingReferences(entities),
        businessInsert(
          entities.articles,
          'article',
          [
            { field: 'owner_id', value: businessCaller() },
            ...publishingReferenceValues(entities),
            ...values()
          ],
          fields
        ),
        publishingHistory(entities, 'created', businessLiteral('draft'), true)
      ],
      { resultName: 'article', fields }
    ),
    businessCommand(
      `update-${profile.prefix}-article`,
      `Edit my ${profile.prefix} article draft`,
      publishingAccess(profile, entities),
      [
        businessUUIDParameter('articleId'),
        ...parameters(profile),
        businessStringParameter('note', 500)
      ],
      [
        readPublishingArticle(profile, entities),
        publishingStatus('draft'),
        ...publishingReferences(entities),
        businessUpdate(
          entities.articles,
          'article',
          'updated',
          [...publishingReferenceValues(entities), ...values(), publishingRevision('article')],
          fields
        ),
        publishingHistory(entities, 'edited', businessLiteral('draft'))
      ],
      { resultName: 'updated', fields }
    ),
    transition(profile, entities, true),
    transition(profile, entities, false)
  ]
}
