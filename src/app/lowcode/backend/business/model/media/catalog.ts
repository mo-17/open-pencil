import type {
  BackendCommandDefinitionIR,
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
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { mediaDomain, type MediaEntities, type MediaKind } from './fields'
import { MEDIA_CREATE_POLICIES } from './permissions'
import {
  mediaAccess,
  mediaHistory,
  mediaPlaybackReady,
  mediaRevision,
  mediaStatus,
  readMedia
} from './steps'

const CONTENT_INPUTS = [
  ['title', 'title', 200],
  ['category', 'category', 100],
  ['description', 'description', 2000],
  ['playbackUrl', 'playback_url', 2048],
  ['posterUrl', 'poster_url', 2048]
] as const
const parameters = () =>
  CONTENT_INPUTS.map(([name, , maximum]) => businessStringParameter(name, maximum))
const values = (): BackendCommandValueIR[] =>
  CONTENT_INPUTS.map(([name, field]) => ({ field, value: businessParameter(name) }))

export function mediaCatalogCommands(
  entities: MediaEntities,
  kind: MediaKind
): BackendCommandDefinitionIR[] {
  const domain = mediaDomain(entities, kind)
  const returns = { resultName: 'updated', fields: [...domain.fields] }
  const mutationParameters = () => [
    businessUUIDParameter(domain.parameter),
    businessStringParameter('note', 500)
  ]
  const commands = [
    businessCommand(
      `create-media-${kind}`,
      `Create my ${kind} draft`,
      {
        kind: 'row-policy',
        entityId: entities.users.id,
        parameter: 'userId',
        policyIds: [...MEDIA_CREATE_POLICIES]
      },
      [businessUUIDParameter('userId'), ...parameters()],
      [
        businessRead(
          entities.users,
          'profile',
          businessParameter('userId'),
          ['id', 'active'],
          'owner'
        ),
        businessAssert(
          'active_creator_profile',
          businessResult('profile', 'active'),
          businessLiteral(true)
        ),
        businessInsert(
          domain.entity,
          'media',
          [{ field: 'owner_id', value: businessCaller() }, ...values()],
          ['owner_id', ...domain.fields]
        ),
        mediaHistory(domain, 'created', businessLiteral('draft'), true)
      ],
      { resultName: 'media', fields: [...domain.fields] }
    ),
    businessCommand(
      `update-media-${kind}`,
      `Edit a ${kind} I manage`,
      mediaAccess(domain),
      [
        businessUUIDParameter(domain.parameter),
        ...parameters(),
        businessStringParameter('note', 500)
      ],
      [
        readMedia(domain),
        mediaStatus('archived', 'neq'),
        mediaHistory(domain, 'edited'),
        businessUpdate(
          domain.entity,
          'media',
          'updated',
          [...values(), mediaRevision()],
          domain.fields
        )
      ],
      returns
    ),
    businessCommand(
      `archive-media-${kind}`,
      `Archive a ${kind} I manage`,
      mediaAccess(domain),
      mutationParameters(),
      [
        readMedia(domain),
        mediaStatus('archived', 'neq'),
        ...(kind === 'channel' ? [mediaStatus('live', 'neq')] : []),
        mediaHistory(domain, 'archived', businessLiteral('archived')),
        businessUpdate(
          domain.entity,
          'media',
          'updated',
          [{ field: 'status', value: businessLiteral('archived') }, mediaRevision()],
          domain.fields
        )
      ],
      returns
    ),
    businessCommand(
      `restore-media-${kind}`,
      `Restore an archived ${kind} as a draft`,
      mediaAccess(domain),
      mutationParameters(),
      [
        readMedia(domain),
        mediaStatus('archived'),
        mediaHistory(domain, 'restored', businessLiteral('draft')),
        businessUpdate(
          domain.entity,
          'media',
          'updated',
          [
            { field: 'status', value: businessLiteral('draft') },
            ...(kind === 'channel'
              ? [{ field: 'scheduled_at', value: businessLiteral(null) }]
              : []),
            mediaRevision()
          ],
          domain.fields
        )
      ],
      returns
    )
  ]
  if (kind === 'video')
    commands.push(
      businessCommand(
        'publish-media-video',
        'Publish a video playback page',
        mediaAccess(domain),
        mutationParameters(),
        [
          readMedia(domain),
          mediaStatus('draft'),
          mediaPlaybackReady(),
          mediaHistory(domain, 'published', businessLiteral('published')),
          businessUpdate(
            domain.entity,
            'media',
            'updated',
            [{ field: 'status', value: businessLiteral('published') }, mediaRevision()],
            domain.fields
          )
        ],
        returns
      )
    )
  return commands
}
