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
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { MEDIA_FAVORITE_FIELDS, mediaDomain, type MediaEntities } from './fields'
import { MEDIA_PUBLISHED_VIDEO_POLICY } from './permissions'
import { mediaRevision, mediaStatus, readMedia } from './steps'

export function mediaFavoriteCommands(entities: MediaEntities): BackendCommandDefinitionIR[] {
  const domain = mediaDomain(entities, 'video')
  const publishedAccess: BackendCommandDefinitionIR['access'] = {
    kind: 'row-policy',
    entityId: entities.videos.id,
    parameter: 'videoId',
    policyIds: [MEDIA_PUBLISHED_VIDEO_POLICY]
  }
  const readFavorite = () =>
    businessRead(
      entities.favorites,
      'favorite',
      businessParameter('favoriteId'),
      MEDIA_FAVORITE_FIELDS,
      'owner'
    )
  const returns = { resultName: 'updated', fields: [...MEDIA_FAVORITE_FIELDS] }
  return [
    businessCommand(
      'create-media-favorite',
      'Save a published video to my favorites once',
      publishedAccess,
      [businessUUIDParameter('videoId')],
      [
        readMedia(domain),
        mediaStatus('published'),
        businessInsert(
          entities.favorites,
          'favorite',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'video_id', value: businessResult('media', 'id') },
            { field: 'video_title', value: businessResult('media', 'title') }
          ],
          MEDIA_FAVORITE_FIELDS
        )
      ],
      { resultName: 'favorite', fields: [...MEDIA_FAVORITE_FIELDS] }
    ),
    businessCommand(
      'cancel-media-favorite',
      'Cancel my existing favorite without reading private video data',
      {
        kind: 'row-policy',
        entityId: entities.favorites.id,
        parameter: 'favoriteId',
        policyIds: ['own-media-favorites']
      },
      [businessUUIDParameter('favoriteId')],
      [
        readFavorite(),
        businessUpdate(
          entities.favorites,
          'favorite',
          'updated',
          [{ field: 'active', value: businessLiteral(false) }, mediaRevision('favorite')],
          MEDIA_FAVORITE_FIELDS
        )
      ],
      returns
    ),
    businessCommand(
      'restore-media-favorite',
      'Restore the original favorite after checking video publication',
      publishedAccess,
      [businessUUIDParameter('videoId'), businessUUIDParameter('favoriteId')],
      [
        readMedia(domain),
        mediaStatus('published'),
        readFavorite(),
        businessAssert(
          'favorite_video_matches',
          businessResult('favorite', 'video_id'),
          businessResult('media', 'id')
        ),
        businessUpdate(
          entities.favorites,
          'favorite',
          'updated',
          [
            { field: 'active', value: businessLiteral(true) },
            { field: 'video_title', value: businessResult('media', 'title') },
            mediaRevision('favorite')
          ],
          MEDIA_FAVORITE_FIELDS
        )
      ],
      returns
    )
  ]
}
