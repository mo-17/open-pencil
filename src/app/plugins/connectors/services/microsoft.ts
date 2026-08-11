import {
  assertServiceTimeWindow,
  defineReviewedService,
  EMPTY_SERVICE_PARAMETERS,
  serviceItem,
  serviceListResult,
  serviceSummary,
  serviceValue
} from './shared'

const MICROSOFT_GRAPH_ORIGIN = 'https://graph.microsoft.com'

function graphPage(value: unknown, source = 'value') {
  return {
    values: serviceValue(value, source),
    truncated: serviceValue(value, '@odata.nextLink') !== undefined
  }
}

function graphList(value: unknown, map: Parameters<typeof serviceListResult>[1]) {
  const page = graphPage(value)
  return serviceListResult(page.values, map, { truncated: page.truncated })
}

function graphDisplayItem(entry: unknown, options: Parameters<typeof serviceItem>[2]) {
  return serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'displayName'), options)
}

export const SHAREPOINT_ROOT_SITE_SERVICE = defineReviewedService({
  key: 'sharepoint-root-site',
  category: 'storage',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Microsoft Graph access token (manual)',
    scopes: ['Sites.Read.All'],
    note: 'Microsoft Entra app registration and tenant consent remain manual; this first release reads root-site metadata only.'
  },
  connector: {
    pluginId: 'open-pencil.sharepoint',
    connectorId: 'sharepoint.root-site',
    adapterId: 'open-pencil.connector.sharepoint-root-site',
    name: 'SharePoint Root Site',
    description: 'Read basic metadata for the Microsoft Graph root SharePoint site.',
    origin: MICROSOFT_GRAPH_ORIGIN,
    credentials: [
      {
        slotId: 'access-token',
        label: 'Microsoft Graph access token (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'get-root-site',
    name: 'Get root site',
    description: 'Read the tenant root site identity without traversing document libraries.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/v1.0/sites/root',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: EMPTY_SERVICE_PARAMETERS,
    headers: { Accept: 'application/json' },
    example: {},
    transformResponse(value) {
      return serviceListResult([value], (entry) =>
        serviceItem(
          serviceValue(entry, 'id'),
          serviceValue(entry, 'displayName') ?? serviceValue(entry, 'name'),
          {
            type: 'site',
            summary: serviceSummary(
              serviceValue(entry, 'name'),
              serviceValue(entry, 'isPersonalSite')
            ),
            url: serviceValue(entry, 'webUrl'),
            timestamp: serviceValue(entry, 'lastModifiedDateTime')
          }
        )
      )
    }
  }
})

export const OUTLOOK_MAIL_FOLDERS_SERVICE = defineReviewedService({
  key: 'outlook-mail-folders',
  category: 'communication',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Microsoft Graph access token (manual)',
    scopes: ['Mail.ReadBasic'],
    note: 'The first release lists folder metadata only; message content and sending stay out of MCP.'
  },
  connector: {
    pluginId: 'open-pencil.outlook-email',
    connectorId: 'outlook.mail-folders',
    adapterId: 'open-pencil.connector.outlook-mail-folders',
    name: 'Outlook Mail Folders',
    description: 'List Outlook mail folder metadata without reading or sending message content.',
    origin: MICROSOFT_GRAPH_ORIGIN,
    credentials: [
      {
        slotId: 'access-token',
        label: 'Microsoft Graph access token (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'list-mail-folders',
    name: 'List mail folders',
    description: 'List the signed-in user’s top-level mail folders and bounded count metadata.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/v1.0/me/mailFolders',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: EMPTY_SERVICE_PARAMETERS,
    headers: { Accept: 'application/json' },
    example: {},
    transformResponse(value) {
      return graphList(value, (entry) =>
        graphDisplayItem(entry, {
          type: 'mail-folder',
          summary: serviceSummary(
            serviceValue(entry, 'unreadItemCount'),
            serviceValue(entry, 'totalItemCount')
          )
        })
      )
    }
  }
})

export const OUTLOOK_CALENDAR_EVENTS_SERVICE = defineReviewedService({
  key: 'outlook-calendar-events',
  category: 'calendar',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Microsoft Graph access token (manual)',
    scopes: ['Calendars.ReadBasic'],
    note: 'Request Calendars.ReadBasic only; richer calendar content remains outside this connector.'
  },
  connector: {
    pluginId: 'open-pencil.outlook-calendar',
    connectorId: 'outlook-calendar.events',
    adapterId: 'open-pencil.connector.outlook-calendar-events',
    name: 'Outlook Calendar Events',
    description: 'List basic event instances from an explicit Outlook calendar time window.',
    origin: MICROSOFT_GRAPH_ORIGIN,
    credentials: [
      {
        slotId: 'access-token',
        label: 'Microsoft Graph access token (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'list-events',
    name: 'List calendar events',
    description: 'List a bounded page of basic default-calendar event instances.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/v1.0/me/calendarView',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        startDateTime: { type: 'string', minLength: 1, maxLength: 64 },
        endDateTime: { type: 'string', minLength: 1, maxLength: 64 },
        select: {
          type: 'string',
          enum: ['id,subject,start,end,location,organizer,isCancelled,webLink,type']
        },
        top: { type: 'integer', minimum: 1, maximum: 50 }
      },
      required: ['startDateTime', 'endDateTime', 'select'],
      additionalProperties: false,
      minProperties: 3,
      maxProperties: 4
    },
    query: [
      { parameter: 'startDateTime', name: 'startDateTime' },
      { parameter: 'endDateTime', name: 'endDateTime' },
      { parameter: 'select', name: '$select' },
      { parameter: 'top', name: '$top' }
    ],
    headers: { Accept: 'application/json' },
    example: {
      startDateTime: '2026-08-10T00:00:00Z',
      endDateTime: '2026-08-17T00:00:00Z',
      select: 'id,subject,start,end,location,organizer,isCancelled,webLink,type',
      top: 25
    },
    validateParameters(parameters) {
      assertServiceTimeWindow(parameters, 'startDateTime', 'endDateTime')
    },
    transformResponse(value) {
      return graphList(value, (entry) =>
        serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'subject'), {
          type: serviceValue(entry, 'type'),
          summary: serviceSummary(
            serviceValue(entry, 'organizer', 'emailAddress', 'name'),
            serviceValue(entry, 'location', 'displayName')
          ),
          url: serviceValue(entry, 'webLink'),
          timestamp: serviceValue(entry, 'start', 'dateTime')
        })
      )
    }
  }
})

export const TEAMS_JOINED_TEAMS_SERVICE = defineReviewedService({
  key: 'teams-joined-teams',
  category: 'communication',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Microsoft Graph access token (manual)',
    scopes: ['Team.ReadBasic.All'],
    note: 'This delegated scope is available for work or school accounts, not personal Microsoft accounts.'
  },
  connector: {
    pluginId: 'open-pencil.teams',
    connectorId: 'teams.joined-teams',
    adapterId: 'open-pencil.connector.teams-joined-teams',
    name: 'Microsoft Teams',
    description: 'List teams the signed-in work or school user directly belongs to.',
    origin: MICROSOFT_GRAPH_ORIGIN,
    credentials: [
      {
        slotId: 'access-token',
        label: 'Microsoft Graph access token (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'list-joined-teams',
    name: 'List joined teams',
    description: 'List basic identities for teams the current user directly joined.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/v1.0/me/joinedTeams',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: EMPTY_SERVICE_PARAMETERS,
    headers: { Accept: 'application/json' },
    example: {},
    transformResponse(value) {
      return graphList(value, (entry) =>
        graphDisplayItem(entry, {
          type: 'team',
          summary: serviceValue(entry, 'description'),
          url: serviceValue(entry, 'webUrl')
        })
      )
    }
  }
})

export const REVIEWED_MICROSOFT_SERVICES = Object.freeze([
  SHAREPOINT_ROOT_SITE_SERVICE,
  OUTLOOK_MAIL_FOLDERS_SERVICE,
  OUTLOOK_CALENDAR_EVENTS_SERVICE,
  TEAMS_JOINED_TEAMS_SERVICE
])
