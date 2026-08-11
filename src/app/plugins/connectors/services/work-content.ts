import {
  defineReviewedService,
  EMPTY_SERVICE_PARAMETERS,
  serviceArray,
  serviceItem,
  serviceListResult,
  serviceSummary,
  serviceValue
} from './shared'

export const ASANA_WORKSPACES_SERVICE = defineReviewedService({
  key: 'asana-workspaces',
  category: 'work-management',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Asana access token (manual)',
    scopes: ['workspaces:read'],
    note: 'Paste an OAuth or personal access token with workspace read access.'
  },
  connector: {
    pluginId: 'open-pencil.asana',
    connectorId: 'asana.workspaces',
    adapterId: 'open-pencil.connector.asana-workspaces',
    name: 'Asana Workspaces',
    description: 'List workspaces visible to the authenticated Asana user.',
    origin: 'https://app.asana.com',
    credentials: [
      { slotId: 'access-token', label: 'Asana access token (manual)', kind: 'bearer-token' }
    ]
  },
  operation: {
    operationId: 'list-workspaces',
    name: 'List workspaces',
    description: 'List one bounded page of Asana workspace identities.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/api/1.0/workspaces',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        optFields: { type: 'string', enum: ['name,is_organization'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'string', minLength: 1, maxLength: 1_024 }
      },
      required: ['optFields'],
      additionalProperties: false,
      minProperties: 1,
      maxProperties: 3
    },
    query: [
      { parameter: 'optFields', name: 'opt_fields' },
      { parameter: 'limit', name: 'limit' },
      { parameter: 'offset', name: 'offset' }
    ],
    headers: { Accept: 'application/json' },
    example: { optFields: 'name,is_organization', limit: 25 },
    transformResponse(value) {
      return serviceListResult(
        serviceValue(value, 'data'),
        (entry) =>
          serviceItem(serviceValue(entry, 'gid'), serviceValue(entry, 'name'), {
            type: serviceValue(entry, 'resource_type'),
            summary: serviceValue(entry, 'is_organization')
          }),
        { nextCursor: serviceValue(value, 'next_page', 'offset') }
      )
    }
  }
})

export const ZOTERO_TOP_ITEMS_SERVICE = defineReviewedService({
  key: 'zotero-top-items',
  category: 'content-ai',
  manualSetup: {
    mode: 'manual-api-key',
    credentialLabel: 'Zotero API key (manual)',
    scopes: ['library:read'],
    note: 'Create a dedicated read-only Zotero API key and enter the numeric user ID separately.'
  },
  connector: {
    pluginId: 'open-pencil.zotero',
    connectorId: 'zotero.top-items',
    adapterId: 'open-pencil.connector.zotero-top-items',
    name: 'Zotero Top Items',
    description: 'List top-level bibliography items in one explicit Zotero user library.',
    origin: 'https://api.zotero.org',
    credentials: [
      {
        slotId: 'api-key',
        label: 'Zotero API key (manual)',
        kind: 'api-key',
        headerName: 'Zotero-API-Key'
      }
    ]
  },
  operation: {
    operationId: 'list-top-items',
    name: 'List top items',
    description: 'List a bounded, recently modified slice of top-level bibliography items.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/users/{userId}/items/top',
    credentialSlots: ['api-key'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', minLength: 1, maxLength: 32 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        start: { type: 'integer', minimum: 0, maximum: 1_000_000 },
        sort: { type: 'string', enum: ['dateModified'] },
        direction: { type: 'string', enum: ['desc'] }
      },
      required: ['userId', 'sort', 'direction'],
      additionalProperties: false,
      minProperties: 3,
      maxProperties: 5
    },
    query: [
      { parameter: 'limit', name: 'limit' },
      { parameter: 'start', name: 'start' },
      { parameter: 'sort', name: 'sort' },
      { parameter: 'direction', name: 'direction' }
    ],
    headers: { Accept: 'application/json', 'Zotero-API-Version': '3' },
    example: {
      userId: '123456',
      limit: 25,
      start: 0,
      sort: 'dateModified',
      direction: 'desc'
    },
    transformResponse(value, context) {
      const entries = serviceArray(value)
      return serviceListResult(
        entries,
        (entry) =>
          serviceItem(serviceValue(entry, 'key'), serviceValue(entry, 'data', 'title'), {
            type: serviceValue(entry, 'data', 'itemType'),
            summary: serviceSummary(
              serviceValue(entry, 'data', 'date'),
              serviceValue(entry, 'data', 'publicationTitle'),
              serviceValue(entry, 'data', 'DOI')
            ),
            url:
              serviceValue(entry, 'data', 'url') ??
              serviceValue(entry, 'links', 'alternate', 'href'),
            timestamp: serviceValue(entry, 'data', 'dateModified')
          }),
        {
          truncated:
            typeof context.parameters.limit === 'number' &&
            entries.length >= context.parameters.limit
        }
      )
    }
  }
})

export const HEYGEN_AVATARS_SERVICE = defineReviewedService({
  key: 'heygen-avatars',
  category: 'content-ai',
  manualSetup: {
    mode: 'manual-api-key',
    credentialLabel: 'HeyGen API key (manual)',
    scopes: [],
    note: 'Paste a HeyGen API key; this connector only lists available avatars.'
  },
  connector: {
    pluginId: 'open-pencil.heygen',
    connectorId: 'heygen.avatars',
    adapterId: 'open-pencil.connector.heygen-avatars',
    name: 'HeyGen Avatars',
    description: 'List available HeyGen avatars without starting video generation.',
    origin: 'https://api.heygen.com',
    credentials: [
      {
        slotId: 'api-key',
        label: 'HeyGen API key (manual)',
        kind: 'api-key',
        headerName: 'x-api-key'
      }
    ]
  },
  operation: {
    operationId: 'list-avatars',
    name: 'List avatars',
    description: 'List the bounded avatar catalog available to the current HeyGen account.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/v3/avatars/looks',
    credentialSlots: ['api-key'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        groupId: { type: 'string', minLength: 1, maxLength: 256 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        token: { type: 'string', minLength: 1, maxLength: 2_048 }
      },
      required: [],
      additionalProperties: false,
      minProperties: 0,
      maxProperties: 3
    },
    query: [
      { parameter: 'groupId', name: 'group_id' },
      { parameter: 'limit', name: 'limit' },
      { parameter: 'token', name: 'token' }
    ],
    headers: { Accept: 'application/json' },
    example: { limit: 50 },
    transformResponse(value) {
      return serviceListResult(
        serviceValue(value, 'data'),
        (entry) =>
          serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'name'), {
            type: serviceValue(entry, 'gender'),
            summary: serviceSummary(serviceValue(entry, 'group_id'), serviceValue(entry, 'status')),
            url: serviceValue(entry, 'preview_image_url')
          }),
        {
          nextCursor: serviceValue(value, 'next_token'),
          truncated: serviceValue(value, 'has_more') === true
        }
      )
    }
  }
})

const LINEAR_ISSUES_QUERY = `query OpenPencilIssues($first: Int!, $after: String) {
  issues(first: $first, after: $after) {
    nodes { id identifier title url updatedAt state { name type } }
    pageInfo { hasNextPage endCursor }
  }
}`

export const LINEAR_ISSUES_SERVICE = defineReviewedService({
  key: 'linear-issues',
  category: 'work-management',
  manualSetup: {
    mode: 'manual-oauth-access-token',
    credentialLabel: 'Linear OAuth access token (manual)',
    scopes: ['read'],
    note: 'Use an OAuth access token so the required Authorization Bearer format is unambiguous.'
  },
  connector: {
    pluginId: 'open-pencil.linear',
    connectorId: 'linear.issues',
    adapterId: 'open-pencil.connector.linear-issues',
    name: 'Linear Issues',
    description: 'Run one fixed, host-reviewed GraphQL query that lists Linear issues.',
    origin: 'https://api.linear.app',
    credentials: [
      {
        slotId: 'access-token',
        label: 'Linear OAuth access token (manual)',
        kind: 'bearer-token'
      }
    ]
  },
  operation: {
    operationId: 'list-issues',
    name: 'List issues',
    description: 'List Linear issue summaries through a fixed read-only GraphQL document.',
    kind: 'query',
    method: 'POST',
    pathTemplate: '/graphql',
    credentialSlots: ['access-token'],
    mcpReadOnly: true,
    parameters: {
      type: 'object',
      properties: {
        first: { type: 'integer', minimum: 1, maximum: 50 },
        after: { type: 'string', minLength: 1, maxLength: 1_024 }
      },
      required: ['first'],
      additionalProperties: false,
      minProperties: 1,
      maxProperties: 2
    },
    headers: { Accept: 'application/json' },
    jsonBody: {
      build(parameters) {
        return {
          query: LINEAR_ISSUES_QUERY,
          variables: {
            first: parameters.first,
            ...(parameters.after === undefined ? {} : { after: parameters.after })
          }
        }
      }
    },
    example: { first: 25 },
    transformResponse(value) {
      if (serviceArray(serviceValue(value, 'errors')).length > 0) {
        throw new TypeError('Linear GraphQL response contains errors')
      }
      const issues = serviceValue(value, 'data', 'issues')
      const hasNextPage = serviceValue(issues, 'pageInfo', 'hasNextPage') === true
      return serviceListResult(
        serviceValue(issues, 'nodes'),
        (entry) =>
          serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'title'), {
            type: serviceValue(entry, 'state', 'type'),
            summary: serviceSummary(
              serviceValue(entry, 'identifier'),
              serviceValue(entry, 'state', 'name')
            ),
            url: serviceValue(entry, 'url'),
            timestamp: serviceValue(entry, 'updatedAt')
          }),
        {
          nextCursor: hasNextPage ? serviceValue(issues, 'pageInfo', 'endCursor') : undefined,
          truncated: hasNextPage
        }
      )
    }
  }
})

export const OPENAI_MODELS_SERVICE = defineReviewedService({
  key: 'openai-models',
  category: 'content-ai',
  manualSetup: {
    mode: 'manual-api-key',
    credentialLabel: 'OpenAI API key (manual)',
    scopes: ['models.read'],
    note: 'Paste a project API key; the connector only invokes the model-list endpoint.'
  },
  connector: {
    pluginId: 'open-pencil.openai-developers',
    connectorId: 'openai.models',
    adapterId: 'open-pencil.connector.openai-models',
    name: 'OpenAI Models',
    description: 'List models available to an OpenAI API project key.',
    origin: 'https://api.openai.com',
    credentials: [{ slotId: 'api-key', label: 'OpenAI API key (manual)', kind: 'bearer-token' }]
  },
  operation: {
    operationId: 'list-models',
    name: 'List models',
    description: 'List model identifiers and basic ownership metadata.',
    kind: 'query',
    method: 'GET',
    pathTemplate: '/v1/models',
    credentialSlots: ['api-key'],
    mcpReadOnly: true,
    parameters: EMPTY_SERVICE_PARAMETERS,
    headers: { Accept: 'application/json' },
    example: {},
    transformResponse(value) {
      return serviceListResult(serviceValue(value, 'data'), (entry) =>
        serviceItem(serviceValue(entry, 'id'), serviceValue(entry, 'id'), {
          type: serviceValue(entry, 'object'),
          summary: serviceValue(entry, 'owned_by'),
          timestamp: serviceValue(entry, 'created')
        })
      )
    }
  }
})

export const REVIEWED_WORK_CONTENT_SERVICES = Object.freeze([
  ASANA_WORKSPACES_SERVICE,
  ZOTERO_TOP_ITEMS_SERVICE,
  HEYGEN_AVATARS_SERVICE,
  LINEAR_ISSUES_SERVICE,
  OPENAI_MODELS_SERVICE
])
