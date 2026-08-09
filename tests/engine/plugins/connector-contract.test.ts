import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_CONNECTOR_CONTRACT_FORMAT,
  PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
  PluginConnectorContractRegistry,
  parsePluginConnectorContract,
  resolvePluginConnectorOriginTemplate
} from '@open-pencil/core/plugins'

function emptyContract(maxBytes = 2) {
  return {
    schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
      maxProperties: 0
    },
    maxBytes
  }
}

function validContract() {
  return {
    format: PLUGIN_CONNECTOR_CONTRACT_FORMAT,
    schemaVersion: PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
    pluginId: 'open-pencil.airtable',
    connectorId: 'airtable.records',
    adapterId: 'open-pencil.connector.airtable',
    name: 'Airtable Records',
    description: 'Read bounded records through a reviewed host adapter.',
    kind: 'data-source',
    network: {
      origins: ['https://api.airtable.com'],
      methods: ['GET'],
      credentials: 'omit',
      redirects: 'error'
    },
    credentialSlots: [
      {
        slotId: 'access-token',
        label: 'Access token',
        kind: 'bearer-token',
        required: true
      }
    ],
    operations: [
      {
        operationId: 'list-records',
        name: 'List records',
        description: 'List a bounded page of records.',
        kind: 'query',
        credentialSlots: ['access-token'],
        parameters: {
          schema: {
            type: 'object',
            properties: {
              baseId: { type: 'string', minLength: 1, maxLength: 64 },
              tableId: { type: 'string', minLength: 1, maxLength: 64 }
            },
            required: ['baseId', 'tableId'],
            additionalProperties: false,
            minProperties: 2,
            maxProperties: 2
          },
          maxBytes: 256
        },
        result: emptyContract()
      }
    ]
  }
}

interface MutableRequestFixture {
  origin?: string
  originTemplate?: string
}

describe('plugin connector preparation contract', () => {
  test('normalizes a bounded host-reviewed connector without executing it', () => {
    expect(parsePluginConnectorContract(validContract())).toEqual(validContract())
  })

  test('requires OAuth PKCE and canonical public HTTPS origins', () => {
    const value = validContract()
    value.credentialSlots = [
      {
        slotId: 'oauth',
        label: 'OAuth account',
        kind: 'oauth2',
        required: true,
        oauth2: {
          authorizationOrigin: 'https://airtable.com',
          tokenOrigin: 'https://airtable.com',
          scopes: ['data.records:read'],
          pkceRequired: true
        }
      }
    ] as never
    value.operations[0].credentialSlots = ['oauth']
    expect(parsePluginConnectorContract(value).credentialSlots[0].oauth2?.pkceRequired).toBe(true)

    value.network.origins = ['https://127.0.0.1']
    expect(() => parsePluginConnectorContract(value)).toThrow('canonical public HTTPS origin')
    value.network.origins = ['https://api.airtable.com/v0']
    expect(() => parsePluginConnectorContract(value)).toThrow('canonical public HTTPS origin')
    value.network.origins = ['https://intranet']
    expect(() => parsePluginConnectorContract(value)).toThrow('canonical public HTTPS origin')
    value.network.origins = ['https://service.internal']
    expect(() => parsePluginConnectorContract(value)).toThrow('canonical public HTTPS origin')
  })

  test('rejects unknown credential references and incompatible operations', () => {
    const unknown = validContract()
    unknown.operations[0].credentialSlots = ['missing']
    expect(() => parsePluginConnectorContract(unknown)).toThrow('references unknown slot')

    const incompatible = validContract()
    incompatible.kind = 'action'
    incompatible.operations[0].kind = 'query'
    expect(() => parsePluginConnectorContract(incompatible)).toThrow('incompatible with action')
  })

  test('accepts optional fixed request authority and validates it against network and parameters', () => {
    const value = validContract()
    const request = {
      origin: 'https://api.airtable.com',
      method: 'GET',
      pathTemplate: '/v0/{baseId}/{tableId}',
      maxResponseBytes: 4_096
    }
    Object.assign(value.operations[0], { request })
    expect(parsePluginConnectorContract(value).operations[0].request).toEqual(request)

    request.origin = 'https://content.airtable.com'
    expect(() => parsePluginConnectorContract(value)).toThrow('network policy')
    request.origin = 'https://api.airtable.com'
    request.method = 'POST'
    expect(() => parsePluginConnectorContract(value)).toThrow('network policy')
    request.method = 'GET'
    request.pathTemplate = '/v0/{unknown}'
    expect(() => parsePluginConnectorContract(value)).toThrow('must reference a scalar parameter')
    request.pathTemplate = '/v0/{baseId}/{tableId}'
    request.maxResponseBytes = 4 * 1024 * 1024 + 1
    expect(() => parsePluginConnectorContract(value)).toThrow('maxResponseBytes')
  })

  test('resolves only reviewed whole-label HTTPS origin templates', () => {
    const value = validContract()
    value.network.origins = []
    Object.assign(value.network, {
      originTemplates: ['https://{projectRef}.supabase.co']
    })
    Object.assign(value.operations[0].parameters.schema.properties, {
      projectRef: { type: 'string', minLength: 1, maxLength: 63 }
    })
    value.operations[0].parameters.schema.required.push('projectRef')
    value.operations[0].parameters.schema.minProperties = 3
    value.operations[0].parameters.schema.maxProperties = 3
    Object.assign(value.operations[0], {
      request: {
        originTemplate: 'https://{projectRef}.supabase.co',
        method: 'GET',
        pathTemplate: '/rest/v1/{tableId}'
      }
    })

    const parsed = parsePluginConnectorContract(value)
    expect(parsed.operations[0].request?.origin).toBeUndefined()
    expect(parsed.operations[0].request?.originTemplate).toBe('https://{projectRef}.supabase.co')
    expect(
      resolvePluginConnectorOriginTemplate('https://{projectRef}.supabase.co', {
        projectRef: 'project-ref'
      })
    ).toBe('https://project-ref.supabase.co')
    expect(() =>
      resolvePluginConnectorOriginTemplate('https://{projectRef}.supabase.co', {
        projectRef: 'other.supabase.co'
      })
    ).toThrow('canonical DNS label')

    const request = value.operations[0].request as MutableRequestFixture
    request.origin = 'https://api.supabase.com'
    expect(() => parsePluginConnectorContract(value)).toThrow('exactly one')
    delete request.origin
    request.originTemplate = 'https://{projectRef}.example.com'
    expect(() => parsePluginConnectorContract(value)).toThrow('network policy')
    request.originTemplate = 'https://prefix-{projectRef}.supabase.co'
    expect(() => parsePluginConnectorContract(value)).toThrow('literal hostname label')
    request.originTemplate = 'https://{projectRef}.home.arpa'
    value.network.originTemplates = ['https://{projectRef}.home.arpa']
    expect(() => parsePluginConnectorContract(value)).toThrow('canonical public HTTPS origin')
  })

  test('permits only reviewed non-reserved API-key header injection', () => {
    const value = validContract()
    value.credentialSlots[0] = {
      slotId: 'access-token',
      label: 'Public API key',
      kind: 'api-key',
      required: true,
      injection: { location: 'header', name: 'apikey' }
    } as never
    expect(parsePluginConnectorContract(value).credentialSlots[0].injection).toEqual({
      location: 'header',
      name: 'apikey'
    })

    value.credentialSlots[0].injection.name = 'authorization'
    expect(() => parsePluginConnectorContract(value)).toThrow('allowed credential header')
    value.credentialSlots[0].injection.name = 'X-API-Key'
    expect(() => parsePluginConnectorContract(value)).toThrow('allowed credential header')
    value.credentialSlots[0].injection.name = 'apikey'
    value.credentialSlots[0].kind = 'bearer-token'
    expect(() => parsePluginConnectorContract(value)).toThrow('only valid for an API-key')
  })

  test('requires every required credential slot to be used by an operation', () => {
    const value = validContract()
    value.operations[0].credentialSlots = []
    expect(() => parsePluginConnectorContract(value)).toThrow(
      'required credential slot access-token is not referenced'
    )
  })

  test('does not invoke schema getters or toJSON while rejecting untrusted input', () => {
    let getterCalls = 0
    let toJSONCalls = 0
    const value = validContract()
    value.operations[0].parameters.schema = Object.defineProperty(
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
        maxProperties: 0,
        toJSON() {
          toJSONCalls += 1
          return emptyContract().schema
        }
      },
      'title',
      {
        enumerable: true,
        get() {
          getterCalls += 1
          return 'unsafe'
        }
      }
    ) as never
    expect(() => parsePluginConnectorContract(value)).toThrow('JSON')
    expect(getterCalls).toBe(0)
    expect(toJSONCalls).toBe(0)
  })

  test('reserves document and page automation targets for the host', () => {
    const value = validContract()
    value.operations[0].parameters.schema = {
      type: 'object',
      properties: { document_id: { type: 'string' } },
      additionalProperties: false
    } as never
    expect(() => parsePluginConnectorContract(value)).toThrow(
      'reserved automation target property document_id'
    )
  })

  test('registers only unique reviewed contracts and freezes further registration', () => {
    const registry = new PluginConnectorContractRegistry()
    const registered = registry.register(validContract())
    expect(registry.get(registered.pluginId, registered.connectorId)).toBe(registered)
    expect(() => registry.register(validContract())).toThrow('Duplicate plugin connector contract')

    expect(registry.freeze()).toBe(registry)
    expect(() => registry.register({ ...validContract(), connectorId: 'airtable.other' })).toThrow(
      'registry is frozen'
    )
  })

  test('fails closed when a declared connector does not match reviewed authority', () => {
    const registry = new PluginConnectorContractRegistry()
    registry.register(validContract())

    expect(registry.inspect(validContract())).toMatchObject({ ok: true })

    const unavailable = validContract()
    unavailable.connectorId = 'airtable.unknown'
    expect(registry.inspect(unavailable)).toMatchObject({
      ok: false,
      status: 'host-adapter-unavailable'
    })

    const widened = validContract()
    widened.network.methods = ['GET', 'POST']
    expect(registry.inspect(widened)).toMatchObject({
      ok: false,
      status: 'authority-mismatch'
    })

    expect(registry.inspect({ ...validContract(), schemaVersion: 99 })).toMatchObject({
      ok: false,
      status: 'invalid-contract'
    })
  })
})
