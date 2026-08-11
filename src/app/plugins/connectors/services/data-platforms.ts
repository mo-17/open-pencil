import {
  defineReviewedService,
  EMPTY_SERVICE_PARAMETERS,
  serviceArray,
  serviceItem,
  serviceListResult,
  serviceSummary,
  serviceText,
  serviceValue
} from './shared'

export const NEON_PROJECTS_SERVICE = defineReviewedService({
  key: 'neon-projects',
  category: 'developer-data',
  manualSetup: {
    mode: 'manual-api-key',
    credentialLabel: 'Neon API key (manual)',
    scopes: [],
    note: 'Create a personal, organization, or project-scoped key in Neon and paste it once.'
  },
  connector: {
    pluginId: 'open-pencil.neon-postgres',
    connectorId: 'neon.projects',
    adapterId: 'open-pencil.connector.neon-projects',
    name: 'Neon Projects',
    description: 'List a bounded page of Neon projects through the reviewed Neon API origin.',
    origin: 'https://console.neon.tech',
    credentials: [{ slotId: 'api-key', label: 'Neon API key (manual)', kind: 'bearer-token' }]
  },
  operation: {
    operationId: 'list-projects',
    name: 'List projects',
    description: 'List or search Neon projects without changing database resources.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/api/v2/projects',
    credentialSlots: ['api-key'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        cursor: { type: 'string', minLength: 1, maxLength: 512 },
        search: { type: 'string', minLength: 1, maxLength: 256 },
        orgId: { type: 'string', minLength: 1, maxLength: 60 }
      },
      required: [],
      additionalProperties: false,
      minProperties: 0,
      maxProperties: 4
    },
    query: [
      { parameter: 'limit', name: 'limit' },
      { parameter: 'cursor', name: 'cursor' },
      { parameter: 'search', name: 'search' },
      { parameter: 'orgId', name: 'org_id' }
    ],
    headers: { Accept: 'application/json' },
    example: { limit: 20 },
    transformResponse(value) {
      const cursor = serviceValue(value, 'pagination', 'cursor')
      return serviceListResult(
        serviceValue(value, 'projects'),
        (entry) =>
          serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'name'), {
            type: 'project',
            summary: serviceSummary(
              serviceValue(entry, 'region_id'),
              serviceValue(entry, 'pg_version')
            ),
            timestamp: serviceValue(entry, 'created_at')
          }),
        { nextCursor: cursor }
      )
    }
  }
})

export const SENTRY_ISSUES_SERVICE = defineReviewedService({
  key: 'sentry-issues',
  category: 'developer-data',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Sentry auth token (manual)',
    scopes: ['event:read'],
    note: 'Paste a Sentry internal-integration token limited to event read access.'
  },
  connector: {
    pluginId: 'open-pencil.sentry',
    connectorId: 'sentry.issues',
    adapterId: 'open-pencil.connector.sentry-issues',
    name: 'Sentry Issues',
    description: 'List issue summaries for one explicit Sentry organization.',
    origin: 'https://sentry.io',
    credentials: [
      { slotId: 'access-token', label: 'Sentry auth token (manual)', kind: 'bearer-token' }
    ]
  },
  operation: {
    operationId: 'list-issues',
    name: 'List organization issues',
    description: 'List a bounded issue page by organization slug without reading event payloads.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/api/0/organizations/{organization}/issues/',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        organization: { type: 'string', minLength: 1, maxLength: 128 },
        cursor: { type: 'string', minLength: 1, maxLength: 512 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        query: { type: 'string', minLength: 1, maxLength: 256 }
      },
      required: ['organization'],
      additionalProperties: false,
      minProperties: 1,
      maxProperties: 4
    },
    query: [
      { parameter: 'cursor', name: 'cursor' },
      { parameter: 'limit', name: 'limit' },
      { parameter: 'query', name: 'query' }
    ],
    headers: { Accept: 'application/json' },
    example: { organization: 'acme', limit: 25 },
    transformResponse(value, context) {
      const values = serviceArray(value)
      return serviceListResult(
        values,
        (entry) =>
          serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'title'), {
            type: serviceValue(entry, 'level'),
            summary: serviceSummary(
              serviceValue(entry, 'shortId'),
              serviceValue(entry, 'status'),
              serviceValue(entry, 'culprit')
            ),
            url: serviceValue(entry, 'permalink'),
            timestamp: serviceValue(entry, 'lastSeen')
          }),
        {
          truncated:
            typeof context.parameters.limit === 'number' &&
            values.length >= context.parameters.limit
        }
      )
    }
  }
})

export const HUBSPOT_CONTACTS_SERVICE = defineReviewedService({
  key: 'hubspot-contacts',
  category: 'developer-data',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'HubSpot private app or OAuth token (manual)',
    scopes: ['crm.objects.contacts.read'],
    note: 'Use a private app token or OAuth access token with contacts read access.'
  },
  connector: {
    pluginId: 'open-pencil.hubspot',
    connectorId: 'hubspot.contacts',
    adapterId: 'open-pencil.connector.hubspot-contacts',
    name: 'HubSpot Contacts',
    description: 'List basic HubSpot CRM contact records through the current reviewed API.',
    origin: 'https://api.hubapi.com',
    credentials: [
      {
        slotId: 'access-token',
        label: 'HubSpot private app or OAuth token (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'list-contacts',
    name: 'List contacts',
    description: 'List one bounded HubSpot contacts page with basic identity fields only.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/crm/objects/2026-03/contacts',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        properties: {
          type: 'string',
          enum: ['firstname,lastname,lastmodifieddate']
        },
        archived: { type: 'boolean', enum: [false] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        after: { type: 'string', minLength: 1, maxLength: 512 }
      },
      required: ['properties', 'archived'],
      additionalProperties: false,
      minProperties: 2,
      maxProperties: 4
    },
    query: [
      { parameter: 'properties', name: 'properties' },
      { parameter: 'archived', name: 'archived' },
      { parameter: 'limit', name: 'limit' },
      { parameter: 'after', name: 'after' }
    ],
    headers: { Accept: 'application/json' },
    example: {
      properties: 'firstname,lastname,lastmodifieddate',
      archived: false,
      limit: 25
    },
    transformResponse(value) {
      const cursor = serviceValue(value, 'paging', 'next', 'after')
      return serviceListResult(
        serviceValue(value, 'results'),
        (entry) => {
          const first = serviceText(serviceValue(entry, 'properties', 'firstname'), 256)
          const last = serviceText(serviceValue(entry, 'properties', 'lastname'), 256)
          const name = serviceText([first, last].filter(Boolean).join(' '), 512)
          return serviceItem(serviceValue(entry, 'id'), name, {
            type: 'contact',
            timestamp:
              serviceValue(entry, 'properties', 'lastmodifieddate') ??
              serviceValue(entry, 'updatedAt')
          })
        },
        { nextCursor: cursor }
      )
    }
  }
})

export const APOLLO_LISTS_SERVICE = defineReviewedService({
  key: 'apollo-lists',
  category: 'developer-data',
  manualSetup: {
    mode: 'manual-api-key',
    credentialLabel: 'Apollo API key (manual)',
    scopes: ['tags_list'],
    note: 'Create an Apollo key with only the list-reading scope and paste it once.'
  },
  connector: {
    pluginId: 'open-pencil.apollo',
    connectorId: 'apollo.lists',
    adapterId: 'open-pencil.connector.apollo-lists',
    name: 'Apollo Lists',
    description: 'Read the saved contact and account lists available in Apollo.',
    origin: 'https://api.apollo.io',
    credentials: [
      {
        slotId: 'api-key',
        label: 'Apollo API key (manual)',
        kind: 'api-key',
        headerName: 'x-api-key'
      }
    ]
  },
  operation: {
    operationId: 'list-lists',
    name: 'List Apollo lists',
    description: 'List Apollo saved lists without consuming enrichment credits.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/api/v1/labels',
    credentialSlots: ['api-key'],
    mcpReadOnly: true,
    parameters: EMPTY_SERVICE_PARAMETERS,
    headers: { Accept: 'application/json' },
    example: {},
    transformResponse(value) {
      return serviceListResult(value, (entry) =>
        serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'name'), {
          type: serviceValue(entry, 'modality'),
          summary: serviceValue(entry, 'cached_count'),
          timestamp: serviceValue(entry, 'updated_at')
        })
      )
    }
  }
})

export const POSTHOG_INSIGHTS_SERVICE = defineReviewedService({
  key: 'posthog-insights-us',
  category: 'developer-data',
  manualSetup: {
    mode: 'manual-api-key',
    credentialLabel: 'PostHog personal API key (manual)',
    scopes: ['insight:read'],
    note: 'This connector is pinned to PostHog US Cloud; EU and self-hosted origins need separate review.'
  },
  connector: {
    pluginId: 'open-pencil.posthog',
    connectorId: 'posthog.insights-us',
    adapterId: 'open-pencil.connector.posthog-insights-us',
    name: 'PostHog Insights (US)',
    description: 'List saved insights for one PostHog US Cloud project.',
    origin: 'https://us.posthog.com',
    credentials: [
      {
        slotId: 'personal-api-key',
        label: 'PostHog personal API key (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'list-insights',
    name: 'List insights',
    description: 'List cached metadata for one explicit PostHog US Cloud project.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/api/projects/{projectId}/insights/',
    credentialSlots: ['personal-api-key'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1, maxLength: 128 },
        basic: { type: 'boolean', enum: [true] },
        format: { type: 'string', enum: ['json'] },
        refresh: { type: 'string', enum: ['force_cache'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0, maximum: 1_000_000 },
        search: { type: 'string', minLength: 1, maxLength: 256 }
      },
      required: ['projectId', 'basic', 'format', 'refresh'],
      additionalProperties: false,
      minProperties: 4,
      maxProperties: 7
    },
    query: [
      { parameter: 'basic', name: 'basic' },
      { parameter: 'format', name: 'format' },
      { parameter: 'refresh', name: 'refresh' },
      { parameter: 'limit', name: 'limit' },
      { parameter: 'offset', name: 'offset' },
      { parameter: 'search', name: 'search' }
    ],
    headers: { Accept: 'application/json' },
    example: {
      projectId: '12345',
      basic: true,
      format: 'json',
      refresh: 'force_cache',
      limit: 25,
      offset: 0
    },
    transformResponse(value) {
      return serviceListResult(
        serviceValue(value, 'results'),
        (entry) =>
          serviceItem(
            serviceValue(entry, 'id') ?? serviceValue(entry, 'short_id'),
            serviceValue(entry, 'name') ?? serviceValue(entry, 'derived_name'),
            {
              type: 'insight',
              summary: serviceValue(entry, 'description'),
              timestamp: serviceValue(entry, 'updated_at')
            }
          ),
        {
          truncated:
            serviceValue(value, 'next') !== null && serviceValue(value, 'next') !== undefined
        }
      )
    }
  }
})

export const REVIEWED_DATA_PLATFORM_SERVICES = Object.freeze([
  NEON_PROJECTS_SERVICE,
  SENTRY_ISSUES_SERVICE,
  HUBSPOT_CONTACTS_SERVICE,
  APOLLO_LISTS_SERVICE,
  POSTHOG_INSIGHTS_SERVICE
])
