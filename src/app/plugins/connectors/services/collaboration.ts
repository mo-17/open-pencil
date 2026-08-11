import {
  assertServiceTimeWindow,
  defineReviewedService,
  serviceItem,
  serviceListResult,
  serviceSummary,
  serviceValue
} from './shared'

export const BOX_ROOT_ITEMS_SERVICE = defineReviewedService({
  key: 'box-root-items',
  category: 'storage',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Box OAuth access token (manual)',
    scopes: ['root_readonly'],
    note: 'Complete Box OAuth manually and paste an access token with read access to the root folder.'
  },
  connector: {
    pluginId: 'open-pencil.box',
    connectorId: 'box.root-items',
    adapterId: 'open-pencil.connector.box-root-items',
    name: 'Box Root Items',
    description: 'List files, folders, and web links in the authenticated Box root folder.',
    origin: 'https://api.box.com',
    credentials: [
      { slotId: 'access-token', label: 'Box OAuth access token (manual)', kind: 'bearer-token' }
    ]
  },
  operation: {
    operationId: 'list-root-items',
    name: 'List root items',
    description: 'List one marker-paginated page from Box folder 0.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/2.0/folders/0/items',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        useMarker: { type: 'boolean', enum: [true] },
        fields: {
          type: 'string',
          enum: ['id,type,name,size,modified_at,item_status']
        },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        marker: { type: 'string', minLength: 1, maxLength: 2_048 }
      },
      required: ['useMarker', 'fields'],
      additionalProperties: false,
      minProperties: 2,
      maxProperties: 4
    },
    query: [
      { parameter: 'useMarker', name: 'usemarker' },
      { parameter: 'fields', name: 'fields' },
      { parameter: 'limit', name: 'limit' },
      { parameter: 'marker', name: 'marker' }
    ],
    headers: { Accept: 'application/json' },
    example: {
      useMarker: true,
      fields: 'id,type,name,size,modified_at,item_status',
      limit: 50
    },
    transformResponse(value) {
      return serviceListResult(
        serviceValue(value, 'entries'),
        (entry) =>
          serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'name'), {
            type: serviceValue(entry, 'type'),
            summary: serviceSummary(
              serviceValue(entry, 'size'),
              serviceValue(entry, 'item_status')
            ),
            timestamp: serviceValue(entry, 'modified_at')
          }),
        { nextCursor: serviceValue(value, 'next_marker') }
      )
    }
  }
})

export const SLACK_PUBLIC_CHANNELS_SERVICE = defineReviewedService({
  key: 'slack-public-channels',
  category: 'communication',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Slack bot or user token (manual)',
    scopes: ['channels:read'],
    note: 'Install a Slack app manually with channels:read and paste its bot or user token.'
  },
  connector: {
    pluginId: 'open-pencil.slack',
    connectorId: 'slack.public-channels',
    adapterId: 'open-pencil.connector.slack-public-channels',
    name: 'Slack Public Channels',
    description: 'List public Slack channels without reading messages or private conversations.',
    origin: 'https://slack.com',
    credentials: [
      {
        slotId: 'access-token',
        label: 'Slack bot or user token (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'list-public-channels',
    name: 'List public channels',
    description: 'List an explicitly public, non-archived Slack channel page.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/api/conversations.list',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        types: { type: 'string', enum: ['public_channel'] },
        excludeArchived: { type: 'boolean', enum: [true] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        cursor: { type: 'string', minLength: 1, maxLength: 2_048 }
      },
      required: ['types', 'excludeArchived'],
      additionalProperties: false,
      minProperties: 2,
      maxProperties: 4
    },
    query: [
      { parameter: 'types', name: 'types' },
      { parameter: 'excludeArchived', name: 'exclude_archived' },
      { parameter: 'limit', name: 'limit' },
      { parameter: 'cursor', name: 'cursor' }
    ],
    headers: { Accept: 'application/json' },
    example: { types: 'public_channel', excludeArchived: true, limit: 50 },
    transformResponse(value) {
      if (serviceValue(value, 'ok') !== true) {
        throw new TypeError('Slack API rejected the reviewed public-channel request')
      }
      return serviceListResult(
        serviceValue(value, 'channels'),
        (entry) =>
          serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'name'), {
            type: 'public_channel',
            summary: serviceValue(entry, 'topic', 'value'),
            timestamp: serviceValue(entry, 'created')
          }),
        { nextCursor: serviceValue(value, 'response_metadata', 'next_cursor') }
      )
    }
  }
})

export const GOOGLE_CALENDAR_EVENTS_SERVICE = defineReviewedService({
  key: 'google-calendar-events',
  category: 'calendar',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Google Calendar OAuth access token (manual)',
    scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
    note: 'Sensitive-scope verification and the production OAuth consent flow remain a manual release TODO.'
  },
  connector: {
    pluginId: 'open-pencil.google-calendar',
    connectorId: 'google-calendar.events',
    adapterId: 'open-pencil.connector.google-calendar-events',
    name: 'Google Calendar Events',
    description: 'List bounded event metadata from the primary Google Calendar.',
    origin: 'https://www.googleapis.com',
    credentials: [
      {
        slotId: 'access-token',
        label: 'Google Calendar OAuth access token (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'list-events',
    name: 'List events',
    description: 'List expanded event instances in an explicit primary-calendar time window.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/calendar/v3/calendars/primary/events',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        maxResults: { type: 'integer', minimum: 1, maximum: 50 },
        pageToken: { type: 'string', minLength: 1, maxLength: 2_048 },
        timeMin: { type: 'string', minLength: 1, maxLength: 64 },
        timeMax: { type: 'string', minLength: 1, maxLength: 64 },
        query: { type: 'string', minLength: 1, maxLength: 512 },
        singleEvents: { type: 'boolean', enum: [true] },
        orderBy: { type: 'string', enum: ['startTime'] },
        showDeleted: { type: 'boolean', enum: [false] }
      },
      required: ['timeMin', 'timeMax', 'singleEvents', 'orderBy', 'showDeleted'],
      additionalProperties: false,
      minProperties: 5,
      maxProperties: 8
    },
    query: [
      { parameter: 'maxResults', name: 'maxResults' },
      { parameter: 'pageToken', name: 'pageToken' },
      { parameter: 'timeMin', name: 'timeMin' },
      { parameter: 'timeMax', name: 'timeMax' },
      { parameter: 'query', name: 'q' },
      { parameter: 'singleEvents', name: 'singleEvents' },
      { parameter: 'orderBy', name: 'orderBy' },
      { parameter: 'showDeleted', name: 'showDeleted' }
    ],
    headers: { Accept: 'application/json' },
    example: {
      timeMin: '2026-08-10T00:00:00Z',
      timeMax: '2026-08-17T00:00:00Z',
      maxResults: 25,
      singleEvents: true,
      orderBy: 'startTime',
      showDeleted: false
    },
    validateParameters(parameters) {
      assertServiceTimeWindow(parameters, 'timeMin', 'timeMax')
    },
    transformResponse(value) {
      return serviceListResult(
        serviceValue(value, 'items'),
        (entry) =>
          serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'summary'), {
            type: serviceValue(entry, 'status'),
            summary: serviceSummary(
              serviceValue(entry, 'location'),
              serviceValue(entry, 'organizer', 'displayName')
            ),
            url: serviceValue(entry, 'htmlLink'),
            timestamp:
              serviceValue(entry, 'start', 'dateTime') ?? serviceValue(entry, 'start', 'date')
          }),
        { nextCursor: serviceValue(value, 'nextPageToken') }
      )
    }
  }
})

export const REVIEWED_COLLABORATION_SERVICES = Object.freeze([
  BOX_ROOT_ITEMS_SERVICE,
  SLACK_PUBLIC_CHANNELS_SERVICE,
  GOOGLE_CALENDAR_EVENTS_SERVICE
])
