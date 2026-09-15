import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { publishingRevision, publishingStatus, readPublishingArticle } from './steps'
import { BOOKMARK_FIELDS, type PublishingEntities, type PublishingProfile } from './types'

export function publishingBookmarkCommands(
  profile: PublishingProfile,
  entities: PublishingEntities
): BackendCommandDefinitionIR[] {
  const { prefix } = profile
  const access: BackendCommandDefinitionIR['access'] = {
    kind: 'row-policy',
    entityId: entities.articles.id,
    parameter: 'articleId',
    policyIds: [`${prefix}-published-articles`]
  }
  const readBookmark = () =>
    businessRead(
      entities.bookmarks,
      'bookmark',
      businessParameter('bookmarkId'),
      BOOKMARK_FIELDS,
      'owner'
    )
  const returns = { resultName: 'updated', fields: [...BOOKMARK_FIELDS] }
  return [
    businessCommand(
      `create-${prefix}-bookmark`,
      'Bookmark a currently published article once',
      access,
      [businessUUIDParameter('articleId')],
      [
        readPublishingArticle(profile, entities),
        publishingStatus('published'),
        businessInsert(
          entities.bookmarks,
          'bookmark',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'article_id', value: businessResult('article', 'id') }
          ],
          BOOKMARK_FIELDS
        )
      ],
      { resultName: 'bookmark', fields: [...BOOKMARK_FIELDS] }
    ),
    businessCommand(
      `cancel-${prefix}-bookmark`,
      'Cancel my bookmark without reading withdrawn content',
      {
        kind: 'row-policy',
        entityId: entities.bookmarks.id,
        parameter: 'bookmarkId',
        policyIds: [`own-${prefix}-bookmarks`]
      },
      [businessUUIDParameter('bookmarkId')],
      [
        readBookmark(),
        businessUpdate(
          entities.bookmarks,
          'bookmark',
          'updated',
          [{ field: 'active', value: businessLiteral(false) }, publishingRevision('bookmark')],
          BOOKMARK_FIELDS
        )
      ],
      returns
    ),
    businessCommand(
      `restore-${prefix}-bookmark`,
      'Restore my original bookmark after checking current publication',
      access,
      [businessUUIDParameter('articleId'), businessUUIDParameter('bookmarkId')],
      [
        readPublishingArticle(profile, entities),
        publishingStatus('published'),
        readBookmark(),
        businessAssert(
          'bookmark_article_matches',
          businessResult('bookmark', 'article_id'),
          businessResult('article', 'id')
        ),
        businessUpdate(
          entities.bookmarks,
          'bookmark',
          'updated',
          [{ field: 'active', value: businessLiteral(true) }, publishingRevision('bookmark')],
          BOOKMARK_FIELDS
        )
      ],
      returns
    )
  ]
}
