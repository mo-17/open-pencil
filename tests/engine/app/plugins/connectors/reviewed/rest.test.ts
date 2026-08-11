import { describe, expect, test } from 'bun:test'

import {
  PluginConnectorContractRegistry,
  parsePluginConnectorContract
} from '@open-pencil/core/plugins'

import { RedactedConnectorAuditLog } from '@/app/plugins/connectors/audit'
import { ConnectorAuthorizationRegistry } from '@/app/plugins/connectors/authorization'
import { createConnectorExecutionBroker } from '@/app/plugins/connectors/broker'
import { ConnectorHostAdapterRegistry } from '@/app/plugins/connectors/registry'
import {
  createReviewedRestConnector,
  type ReviewedRestConnector
} from '@/app/plugins/connectors/reviewed-rest'
import { ConnectorExecutionError } from '@/app/plugins/connectors/types'
import type { InstalledAppPlugin } from '@/app/plugins/types'

const SIGNAL = new AbortController().signal
const MUTATION_ATTEMPT_ID = '0198b0e2-77ee-4f89-9d67-0e53b74ec243'

const QUERY_PARAMETERS = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    workspaceId: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 32 }),
    search: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 128 }),
    tags: Object.freeze({
      type: 'array' as const,
      items: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 32 }),
      maxItems: 8
    }),
    limit: Object.freeze({ type: 'integer' as const, minimum: 1, maximum: 100 })
  }),
  required: Object.freeze(['workspaceId', 'search']),
  additionalProperties: false as const,
  minProperties: 2,
  maxProperties: 4
})

const QUERY_RESULT = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    items: Object.freeze({
      type: 'array' as const,
      items: Object.freeze({
        type: 'object' as const,
        properties: Object.freeze({
          id: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 64 }),
          title: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 256 })
        }),
        required: Object.freeze(['id', 'title']),
        additionalProperties: false as const,
        minProperties: 2,
        maxProperties: 2
      }),
      maxItems: 100
    }),
    nextCursor: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 128 })
  }),
  required: Object.freeze(['items']),
  additionalProperties: false as const,
  minProperties: 1,
  maxProperties: 2
})

const QUERY = createReviewedRestConnector({
  pluginId: 'test.reviewed-query',
  connectorId: 'fake.search',
  adapterId: 'test.connector.fake-search',
  name: 'Fake Search',
  description: 'Exercise one reviewed REST query without granting arbitrary URL authority.',
  origin: 'https://query.example.com',
  credentials: [
    {
      slotId: 'api-key',
      label: 'API key',
      kind: 'api-key',
      headerName: 'x-fake-api-key'
    }
  ],
  operations: [
    {
      operationId: 'search-items',
      name: 'Search items',
      description: 'Search bounded fake items.',
      kind: 'query',
      method: 'GET',
      pathTemplate: '/v1/workspaces/{workspaceId}/items',
      credentialSlots: ['api-key'],
      mcpReadOnly: true,
      parameters: QUERY_PARAMETERS,
      result: QUERY_RESULT,
      query: [
        { parameter: 'search', name: 'q' },
        { parameter: 'tags', name: 'tag' },
        { parameter: 'limit', name: 'limit' }
      ],
      headers: { 'X-Api-Version': '2026-08-10' },
      responsePath: ['payload'],
      example: { workspaceId: 'workspace-1', search: 'pencil', limit: 10 },
      validateParameters(parameters) {
        if (parameters.search === 'blocked') {
          throw new TypeError('This reviewed example rejects the blocked search value')
        }
      },
      transformResponse(value) {
        const response = value as { records: unknown; cursor?: unknown }
        return {
          items: response.records,
          ...(response.cursor === undefined ? {} : { nextCursor: response.cursor })
        }
      }
    }
  ]
})

const MUTATION_PARAMETERS = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    projectId: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 32 }),
    title: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 256 }),
    enabled: Object.freeze({ type: 'boolean' as const }),
    labels: Object.freeze({
      type: 'array' as const,
      items: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 32 }),
      maxItems: 8
    }),
    dryRun: Object.freeze({ type: 'boolean' as const })
  }),
  required: Object.freeze(['projectId', 'title', 'enabled', 'labels']),
  additionalProperties: false as const,
  minProperties: 4,
  maxProperties: 5
})

const MUTATION_RESULT = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    id: Object.freeze({ type: 'string' as const, minLength: 1, maxLength: 64 }),
    accepted: Object.freeze({ type: 'boolean' as const })
  }),
  required: Object.freeze(['id', 'accepted']),
  additionalProperties: false as const,
  minProperties: 2,
  maxProperties: 2
})

const MUTATION = createReviewedRestConnector({
  pluginId: 'test.reviewed-mutation',
  connectorId: 'fake.jobs',
  adapterId: 'test.connector.fake-jobs',
  name: 'Fake Jobs',
  description: 'Exercise one confirmed REST mutation with a host-owned bearer credential.',
  kind: 'action',
  origin: 'https://mutation.example.com',
  credentials: [{ slotId: 'token', label: 'Access token', kind: 'bearer-token' }],
  operations: [
    {
      operationId: 'create-job',
      name: 'Create job',
      description: 'Create one bounded fake job after confirmation.',
      kind: 'mutation',
      method: 'POST',
      pathTemplate: '/v2/projects/{projectId}/jobs',
      credentialSlots: ['token'],
      mcpReadOnly: false,
      parameters: MUTATION_PARAMETERS,
      result: MUTATION_RESULT,
      query: [{ parameter: 'dryRun', name: 'dry_run' }],
      headers: { 'X-OpenPencil-Client': 'reviewed-rest-test' },
      idempotencyHeader: 'Idempotency-Key',
      jsonBody: {
        build(parameters) {
          return {
            job: {
              title: parameters.title,
              enabled: parameters.enabled,
              labels: parameters.labels
            }
          }
        }
      },
      responsePath: ['data'],
      transformResponse(value) {
        const response = value as { job_id: unknown; status: unknown }
        return { id: response.job_id, accepted: response.status === 'accepted' }
      }
    }
  ]
})

function installedPlugin(connector: ReviewedRestConnector, digest: string): InstalledAppPlugin {
  return {
    package: {
      trustSource: 'app-bundle',
      digest,
      manifest: {
        format: 'openpencil-plugin',
        schemaVersion: 2,
        plugin: {
          id: connector.contract.pluginId,
          name: connector.contract.name,
          version: '1.0.0'
        },
        publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'builtin' },
        engineRange: '>=0.0.0',
        capabilities: [],
        contributions: { modules: [], connectors: [connector.contract] }
      }
    },
    enabled: true,
    pinnedDigest: null
  } as InstalledAppPlugin
}

function errorCode(value: unknown): string | undefined {
  return value instanceof ConnectorExecutionError ? value.code : undefined
}

describe('host-reviewed static REST connector factory', () => {
  test('builds a fixed GET contract, query serializer, MCP allowlist, and credential references', async () => {
    expect(parsePluginConnectorContract(QUERY.contract)).toEqual(QUERY.contract)
    expect(QUERY.contract).toMatchObject({
      pluginId: 'test.reviewed-query',
      network: {
        origins: ['https://query.example.com'],
        methods: ['GET'],
        credentials: 'omit',
        redirects: 'error'
      },
      credentialSlots: [
        {
          slotId: 'api-key',
          kind: 'api-key',
          injection: { location: 'header', name: 'x-fake-api-key' }
        }
      ]
    })
    expect(QUERY.metadata.mcpReadOnlyOperationIds).toEqual(['search-items'])
    expect(QUERY.adapter.mcpReadOnlyOperationIds).toEqual([])
    expect(QUERY.metadata.operations[0]).toMatchObject({
      operationId: 'search-items',
      mcpReadOnly: true,
      example: { workspaceId: 'workspace-1', search: 'pencil', limit: 10 }
    })
    expect(QUERY.credentialRefs('team-a')).toEqual({
      'api-key': {
        integrationId: 'test.reviewed-query',
        profileId: 'team-a',
        field: 'api-key'
      }
    })

    const prepared = await QUERY.adapter.prepare({
      contract: QUERY.contract,
      operation: QUERY.operations['search-items'],
      parameters: {
        workspaceId: 'workspace-1',
        search: 'pencil & paper',
        tags: ['design', 'editor'],
        limit: 25
      },
      signal: SIGNAL
    })
    expect(prepared).toEqual({
      url: 'https://query.example.com/v1/workspaces/workspace-1/items?q=pencil+%26+paper&tag=design&tag=editor&limit=25',
      headers: { 'X-Api-Version': '2026-08-10' }
    })
    expect(JSON.stringify(prepared)).not.toContain('runtime-secret')

    await expect(
      QUERY.adapter.prepare({
        contract: QUERY.contract,
        operation: QUERY.operations['search-items'],
        parameters: { workspaceId: 'workspace-1', search: 'blocked' },
        signal: SIGNAL
      })
    ).rejects.toMatchObject({ code: 'invalid-parameters' })
  })

  test('executes the fake GET through broker-owned API-key injection and bounded normalization', async () => {
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(QUERY.contract)
    const adapters = new ConnectorHostAdapterRegistry(contracts)
    adapters.register(QUERY.adapter)
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = installedPlugin(QUERY, 'sha256:reviewed-query-v1')
    authorization.authorize(QUERY.contract, plugin.package.digest, 1_754_694_400)
    let captured: Readonly<{ url: string; method: string; apiKey: string | null }> | null = null
    const broker = createConnectorExecutionBroker({
      adapters,
      authorization,
      credentialResolver: { resolve: async () => 'runtime-secret' },
      audit: new RedactedConnectorAuditLog(),
      fetch: async (input, init, _limits, onDispatch) => {
        onDispatch()
        const headers = new Headers(init?.headers)
        captured = {
          url: String(input),
          method: String(init?.method),
          apiKey: headers.get('x-fake-api-key')
        }
        return new Response(
          JSON.stringify({
            payload: {
              records: [{ id: 'item-1', title: 'Pencil' }],
              cursor: 'cursor-2',
              ignored: 'upstream field'
            }
          }),
          { status: 200 }
        )
      }
    })

    await expect(
      broker.execute({
        plugin,
        contract: QUERY.contract,
        operationId: 'search-items',
        parameters: { workspaceId: 'workspace-1', search: 'pencil', limit: 10 },
        credentialRefs: QUERY.credentialRefs()
      })
    ).resolves.toMatchObject({
      data: { items: [{ id: 'item-1', title: 'Pencil' }], nextCursor: 'cursor-2' },
      httpStatus: 200
    })
    expect(captured).toEqual({
      url: 'https://query.example.com/v1/workspaces/workspace-1/items?q=pencil&limit=10',
      method: 'GET',
      apiKey: 'runtime-secret'
    })
    expect(captured?.url).not.toContain('runtime-secret')
  })

  test('builds and executes a confirmed POST with safe JSON, query, bearer, and idempotency', async () => {
    expect(MUTATION.metadata.mcpReadOnlyOperationIds).toEqual([])
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(MUTATION.contract)
    const adapters = new ConnectorHostAdapterRegistry(contracts)
    adapters.register(MUTATION.adapter)
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = installedPlugin(MUTATION, 'sha256:reviewed-mutation-v1')
    authorization.authorize(MUTATION.contract, plugin.package.digest, 1_754_694_400)
    let credentialCalls = 0
    let fetchCalls = 0
    let captured: Readonly<{
      url: string
      method: string
      authorization: string | null
      idempotency: string | null
      body: unknown
    }> | null = null
    const broker = createConnectorExecutionBroker({
      adapters,
      authorization,
      credentialResolver: {
        resolve: async () => {
          credentialCalls += 1
          return 'bearer-runtime-only'
        }
      },
      audit: new RedactedConnectorAuditLog(),
      fetch: async (input, init, _limits, onDispatch) => {
        onDispatch()
        fetchCalls += 1
        const headers = new Headers(init?.headers)
        captured = {
          url: String(input),
          method: String(init?.method),
          authorization: headers.get('authorization'),
          idempotency: headers.get('idempotency-key'),
          body: JSON.parse(String(init?.body))
        }
        return new Response(
          JSON.stringify({ data: { job_id: 'job-1', status: 'accepted', ignored: true } }),
          { status: 201 }
        )
      }
    })
    const request = {
      plugin,
      contract: MUTATION.contract,
      operationId: 'create-job',
      parameters: {
        projectId: 'project-1',
        title: 'Render assets',
        enabled: true,
        labels: ['design', 'release'],
        dryRun: false
      },
      mutationAttemptId: MUTATION_ATTEMPT_ID,
      credentialRefs: MUTATION.credentialRefs()
    }

    expect(errorCode(await broker.execute(request).catch((error) => error))).toBe(
      'mutation-confirmation-required'
    )
    expect(credentialCalls).toBe(0)
    expect(fetchCalls).toBe(0)

    await expect(
      broker.execute({ ...request, confirmMutation: async () => true })
    ).resolves.toMatchObject({ data: { id: 'job-1', accepted: true }, httpStatus: 201 })
    expect(captured).toEqual({
      url: 'https://mutation.example.com/v2/projects/project-1/jobs?dry_run=false',
      method: 'POST',
      authorization: 'Bearer bearer-runtime-only',
      idempotency: MUTATION_ATTEMPT_ID,
      body: {
        job: { title: 'Render assets', enabled: true, labels: ['design', 'release'] }
      }
    })
  })

  test('allows a reviewed read-only POST but rejects mutations marked MCP read-only', () => {
    const readOnlyPost = createReviewedRestConnector({
      pluginId: 'test.reviewed-post-query',
      connectorId: 'fake.graphql-search',
      adapterId: 'test.connector.fake-graphql-search',
      name: 'Fake GraphQL Search',
      description: 'Fixed read-only POST search authority.',
      origin: 'https://graphql.example.com',
      operations: [
        {
          operationId: 'search',
          name: 'Search',
          description: 'Search through a fixed POST endpoint.',
          kind: 'query',
          method: 'POST',
          pathTemplate: '/graphql/search',
          mcpReadOnly: true,
          parameters: QUERY_PARAMETERS,
          result: QUERY_RESULT,
          jsonBody: { fields: [{ parameter: 'search', name: 'query' }] }
        }
      ]
    })
    expect(readOnlyPost.adapter.mcpReadOnlyOperationIds).toEqual(['search'])
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(readOnlyPost.contract)
    const adapters = new ConnectorHostAdapterRegistry(contracts)
    expect(adapters.register(readOnlyPost.adapter)).toBe(readOnlyPost.adapter)
    expect(() =>
      adapters.register({
        ...readOnlyPost.adapter,
        mcpReadOnlyOperationIds: ['missing']
      })
    ).toThrow('fixed POST query')

    expect(() =>
      createReviewedRestConnector({
        pluginId: 'test.unsafe-mcp-mutation',
        connectorId: 'fake.unsafe',
        adapterId: 'test.connector.fake-unsafe',
        name: 'Unsafe',
        description: 'Must be rejected before registration.',
        origin: 'https://unsafe.example.com',
        operations: [
          {
            operationId: 'mutate',
            name: 'Mutate',
            description: 'Unsafe MCP declaration.',
            kind: 'mutation',
            method: 'POST',
            pathTemplate: '/v1/mutate',
            mcpReadOnly: true,
            parameters: MUTATION_PARAMETERS,
            result: MUTATION_RESULT
          }
        ]
      })
    ).toThrow('mutations cannot be exposed')
  })

  test('fails closed on widened authority and accessor-bearing body/response data', async () => {
    const widened = structuredClone(QUERY.contract)
    widened.network.origins = ['https://evil.example.com']
    await expect(
      QUERY.adapter.prepare({
        contract: widened,
        operation: widened.operations[0],
        parameters: { workspaceId: 'workspace-1', search: 'pencil' },
        signal: SIGNAL
      })
    ).rejects.toMatchObject({ code: 'authority-mismatch' })

    let responseGetterCalls = 0
    const unsafeResponse = Object.defineProperty({}, 'payload', {
      enumerable: true,
      get() {
        responseGetterCalls += 1
        return { records: [] }
      }
    })
    await expect(
      QUERY.adapter.transformResponse?.(unsafeResponse, {
        contract: QUERY.contract,
        operation: QUERY.operations['search-items'],
        parameters: { workspaceId: 'workspace-1', search: 'pencil' },
        signal: SIGNAL
      })
    ).rejects.toThrow('response path')
    expect(responseGetterCalls).toBe(0)

    let bodyGetterCalls = 0
    const unsafeBodyConnector = createReviewedRestConnector({
      pluginId: 'test.unsafe-body',
      connectorId: 'fake.unsafe-body',
      adapterId: 'test.connector.fake-unsafe-body',
      name: 'Unsafe body',
      description: 'Prove custom builders are copied through JSON data descriptors.',
      origin: 'https://body.example.com',
      operations: [
        {
          operationId: 'send',
          name: 'Send',
          description: 'Send one body.',
          kind: 'mutation',
          method: 'POST',
          pathTemplate: '/v1/send',
          mcpReadOnly: false,
          parameters: MUTATION_PARAMETERS,
          result: MUTATION_RESULT,
          jsonBody: {
            build() {
              return Object.defineProperty({}, 'secret', {
                enumerable: true,
                get() {
                  bodyGetterCalls += 1
                  return 'unsafe'
                }
              })
            }
          }
        }
      ]
    })
    await expect(
      unsafeBodyConnector.adapter.prepare({
        contract: unsafeBodyConnector.contract,
        operation: unsafeBodyConnector.operations.send,
        parameters: {
          projectId: 'project-1',
          title: 'Unsafe',
          enabled: true,
          labels: []
        },
        mutationAttemptId: MUTATION_ATTEMPT_ID,
        signal: SIGNAL
      })
    ).rejects.toThrow('enumerable data property')
    expect(bodyGetterCalls).toBe(0)
  })
})
