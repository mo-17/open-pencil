import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { ARTICLE_FIELDS, ARTICLE_HISTORY_FIELDS, type ContentModel } from './schema'

const ARTICLE_PARAMETERS = [
  businessStringParameter('title', 200),
  businessStringParameter('body', 8192),
  businessStringParameter('category', 100)
]

type ArticleStatus = 'draft' | 'in_review' | 'approved' | 'published'
type ArticleEvent =
  | 'created'
  | 'edited'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'unpublished'

function articleValues(): BackendCommandValueIR[] {
  return ['title', 'body', 'category'].map((field) => ({ field, value: businessParameter(field) }))
}

function articleHistory(
  model: ContentModel,
  event: ArticleEvent,
  noteParameter = false,
  created = false
): BackendCommandStepIR {
  return businessInsert(
    model.history,
    'history',
    [
      {
        field: 'owner_id',
        value: created ? businessCaller() : businessResult('article', 'owner_id')
      },
      { field: 'article_id', value: businessResult('article', 'id') },
      { field: 'actor_id', value: businessCaller() },
      { field: 'event', value: businessLiteral(event) },
      { field: 'note', value: noteParameter ? businessParameter('note') : businessLiteral('') }
    ],
    ARTICLE_HISTORY_FIELDS
  )
}

function articleAccess(
  model: ContentModel,
  roleId: 'content-author' | 'content-reviewer' | 'content-publisher'
): BackendCommandDefinitionIR['access'] {
  const policyIds = [
    {
      'content-author': model.authorPolicy,
      'content-reviewer': model.reviewerPolicy,
      'content-publisher': model.publisherPolicy
    }[roleId]
  ]
  return {
    kind: 'row-policy',
    entityId: model.articles.id,
    parameter: 'articleId',
    policyIds,
    roleId
  }
}

function readArticle(model: ContentModel): BackendCommandStepIR {
  return businessRead(model.articles, 'article', businessParameter('articleId'), [
    'owner_id',
    ...ARTICLE_FIELDS
  ])
}

function articleState(status: ArticleStatus): BackendCommandStepIR {
  return businessAssert(
    'expected-status',
    businessResult('article', 'status'),
    businessLiteral(status)
  )
}

interface ArticleTransition {
  id: string
  name: string
  role: 'content-author' | 'content-reviewer' | 'content-publisher'
  from: ArticleStatus
  to: ArticleStatus
  event: ArticleEvent
  review?: boolean
  visibility?: 'public' | 'internal'
}

function transitionCommand(
  model: ContentModel,
  transition: ArticleTransition
): BackendCommandDefinitionIR {
  const values: BackendCommandValueIR[] = [
    { field: 'status', value: businessLiteral(transition.to) }
  ]
  if (transition.visibility)
    values.push({ field: 'visibility', value: businessLiteral(transition.visibility) })
  if (transition.to === 'published')
    values.push({ field: 'published_at', value: { kind: 'server-now' } })
  if (transition.from === 'published')
    values.push({ field: 'published_at', value: businessLiteral(null) })
  const steps: BackendCommandStepIR[] = [readArticle(model), articleState(transition.from)]
  if (transition.review)
    steps.push({
      id: 'independent-reviewer',
      kind: 'assert',
      left: businessResult('article', 'owner_id'),
      operator: 'neq',
      right: businessCaller(),
      error: 'conflict'
    })
  steps.push(
    businessUpdate(model.articles, 'article', 'updated', values, ARTICLE_FIELDS),
    articleHistory(model, transition.event, transition.review)
  )
  return businessCommand(
    transition.id,
    transition.name,
    articleAccess(model, transition.role),
    [
      businessUUIDParameter('articleId'),
      ...(transition.review ? [businessStringParameter('note', 1000)] : [])
    ],
    steps,
    { resultName: 'updated', fields: [...ARTICLE_FIELDS] }
  )
}

/** Every edit and lifecycle transition locks the article and writes an append-only audit row. */
export function addContentCommands(
  application: BackendApplicationSpecV1,
  model: ContentModel
): void {
  const commands = application.commands?.commands
  if (!commands) throw new Error('Missing business commands.')
  commands.push(
    businessCommand(
      'create-article',
      'Create article draft',
      { kind: 'role', roleId: 'content-author' },
      structuredClone(ARTICLE_PARAMETERS),
      [
        businessInsert(
          model.articles,
          'article',
          [{ field: 'owner_id', value: businessCaller() }, ...articleValues()],
          ARTICLE_FIELDS
        ),
        articleHistory(model, 'created', false, true)
      ],
      { resultName: 'article', fields: [...ARTICLE_FIELDS] }
    ),
    businessCommand(
      'edit-article',
      'Edit article draft',
      articleAccess(model, 'content-author'),
      [businessUUIDParameter('articleId'), ...structuredClone(ARTICLE_PARAMETERS)],
      [
        readArticle(model),
        articleState('draft'),
        businessUpdate(model.articles, 'article', 'updated', articleValues(), ARTICLE_FIELDS),
        articleHistory(model, 'edited')
      ],
      { resultName: 'updated', fields: [...ARTICLE_FIELDS] }
    )
  )
  const transitions: ArticleTransition[] = [
    {
      id: 'submit-article',
      name: 'Submit article for review',
      role: 'content-author',
      from: 'draft',
      to: 'in_review',
      event: 'submitted'
    },
    {
      id: 'approve-article',
      name: 'Approve article',
      role: 'content-reviewer',
      from: 'in_review',
      to: 'approved',
      event: 'approved',
      review: true
    },
    {
      id: 'reject-article',
      name: 'Return article to draft',
      role: 'content-reviewer',
      from: 'in_review',
      to: 'draft',
      event: 'rejected',
      review: true
    },
    {
      id: 'publish-public-article',
      name: 'Publish article publicly',
      role: 'content-publisher',
      from: 'approved',
      to: 'published',
      event: 'published',
      visibility: 'public'
    },
    {
      id: 'publish-internal-article',
      name: 'Publish article internally',
      role: 'content-publisher',
      from: 'approved',
      to: 'published',
      event: 'published',
      visibility: 'internal'
    },
    {
      id: 'unpublish-article',
      name: 'Unpublish article',
      role: 'content-publisher',
      from: 'published',
      to: 'draft',
      event: 'unpublished'
    }
  ]
  commands.push(...transitions.map((transition) => transitionCommand(model, transition)))
}
