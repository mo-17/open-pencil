import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCommand,
  businessLiteral,
  businessParameter,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { mediaDomain, type MediaEntities } from './fields'
import {
  mediaAccess,
  mediaHistory,
  mediaPlaybackReady,
  mediaRevision,
  mediaStatus,
  readMedia
} from './steps'

export function mediaChannelCommands(entities: MediaEntities): BackendCommandDefinitionIR[] {
  const domain = mediaDomain(entities, 'channel')
  const parameters = () => [
    businessUUIDParameter('channelId'),
    businessStringParameter('note', 500)
  ]
  const returns = { resultName: 'updated', fields: [...domain.fields] }
  return [
    businessCommand(
      'schedule-media-channel',
      'Schedule a public channel preview',
      mediaAccess(domain),
      [...parameters(), { name: 'scheduledAt', type: 'datetime', required: true }],
      [
        readMedia(domain),
        mediaStatus('draft'),
        businessAssert(
          'future_schedule',
          businessParameter('scheduledAt'),
          { kind: 'server-now' },
          'gte'
        ),
        mediaHistory(domain, 'scheduled', businessLiteral('scheduled')),
        businessUpdate(
          domain.entity,
          'media',
          'updated',
          [
            { field: 'scheduled_at', value: businessParameter('scheduledAt') },
            { field: 'status', value: businessLiteral('scheduled') },
            mediaRevision()
          ],
          domain.fields
        )
      ],
      returns
    ),
    businessCommand(
      'start-media-channel',
      'Mark a scheduled channel as live; no stream is started',
      mediaAccess(domain),
      parameters(),
      [
        readMedia(domain),
        mediaStatus('scheduled'),
        mediaPlaybackReady(),
        mediaHistory(domain, 'live', businessLiteral('live')),
        businessUpdate(
          domain.entity,
          'media',
          'updated',
          [{ field: 'status', value: businessLiteral('live') }, mediaRevision()],
          domain.fields
        )
      ],
      returns
    ),
    businessCommand(
      'end-media-channel',
      'Mark a live channel as ended; no stream is stopped',
      mediaAccess(domain),
      parameters(),
      [
        readMedia(domain),
        mediaStatus('live'),
        mediaHistory(domain, 'ended', businessLiteral('ended')),
        businessUpdate(
          domain.entity,
          'media',
          'updated',
          [{ field: 'status', value: businessLiteral('ended') }, mediaRevision()],
          domain.fields
        )
      ],
      returns
    )
  ]
}
