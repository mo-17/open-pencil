import { describe, expect, test } from 'bun:test'

import { parsePluginConnectorContract } from '@open-pencil/plugin-contracts'

import {
  AIRTABLE_LIST_RECORDS_OPERATION,
  AIRTABLE_LIST_RECORDS_OPERATION_ID,
  AIRTABLE_RECORDS_ADAPTER_ID,
  AIRTABLE_RECORDS_CONNECTOR_ADAPTER,
  AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID,
  AIRTABLE_RECORDS_LIMITS,
  AIRTABLE_RECORDS_ORIGIN,
  AIRTABLE_RECORDS_PLUGIN_ID,
  normalizeAirtableListRecordsResponse
} from '@/app/plugins/connectors/airtable-records'

function signal(): AbortSignal {
  return new AbortController().signal
}

function clonedContract() {
  return structuredClone(AIRTABLE_RECORDS_CONNECTOR_CONTRACT)
}

function sampleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recRecord123',
    createdTime: '2026-08-09T01:02:03.000Z',
    fields: {
      Name: 'Ada',
      Meta: { z: true, a: 1 },
      Tags: ['design', 'review']
    },
    ...overrides
  }
}

describe('Airtable Records read-only reference connector', () => {
  test('declares one exact GET query with a runtime-only bearer credential slot', () => {
    expect(parsePluginConnectorContract(AIRTABLE_RECORDS_CONNECTOR_CONTRACT)).toEqual(
      AIRTABLE_RECORDS_CONNECTOR_CONTRACT
    )
    expect(AIRTABLE_RECORDS_CONNECTOR_CONTRACT).toMatchObject({
      pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
      connectorId: AIRTABLE_RECORDS_CONNECTOR_ID,
      adapterId: AIRTABLE_RECORDS_ADAPTER_ID,
      kind: 'data-source',
      network: {
        origins: [AIRTABLE_RECORDS_ORIGIN],
        methods: ['GET'],
        credentials: 'omit',
        redirects: 'error'
      }
    })
    expect(AIRTABLE_RECORDS_CONNECTOR_CONTRACT.credentialSlots).toEqual([
      {
        slotId: AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID,
        label: 'Personal access token',
        kind: 'bearer-token',
        required: true
      }
    ])
    expect(AIRTABLE_RECORDS_CONNECTOR_CONTRACT.operations).toHaveLength(1)
    expect(AIRTABLE_LIST_RECORDS_OPERATION).toMatchObject({
      operationId: AIRTABLE_LIST_RECORDS_OPERATION_ID,
      kind: 'query',
      credentialSlots: [AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID],
      request: {
        origin: AIRTABLE_RECORDS_ORIGIN,
        method: 'GET',
        pathTemplate: '/v0/{baseId}/{tableId}',
        maxResponseBytes: AIRTABLE_RECORDS_LIMITS.responseBytes
      }
    })

    const resultSchema = AIRTABLE_LIST_RECORDS_OPERATION.result.schema
    expect(resultSchema.properties.records).toMatchObject({
      type: 'array',
      maxItems: AIRTABLE_RECORDS_LIMITS.records,
      items: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            maxItems: AIRTABLE_RECORDS_LIMITS.fieldsPerRecord,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                valueJson: { type: 'string' }
              },
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      }
    })
  })

  test('prepares only the reviewed Airtable path and bounded pagination query', async () => {
    const prepared = await AIRTABLE_RECORDS_CONNECTOR_ADAPTER.prepare({
      contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
      operation: AIRTABLE_LIST_RECORDS_OPERATION,
      parameters: {
        baseId: 'appBase123',
        tableId: 'tblTable123',
        pageSize: 25,
        offset: 'itrPage123/recLast123'
      },
      signal: signal()
    })

    expect(prepared).toEqual({
      url: 'https://api.airtable.com/v0/appBase123/tblTable123?pageSize=25&offset=itrPage123%2FrecLast123'
    })
    expect(Object.keys(prepared)).toEqual(['url'])
    expect(prepared.headers).toBeUndefined()
    expect(prepared.body).toBeUndefined()
    expect(JSON.stringify(prepared)).not.toContain('Authorization')
    expect(JSON.stringify(prepared)).not.toContain('Bearer')
  })

  test('defaults to one bounded page and rejects path, query, and authority widening', async () => {
    await expect(
      AIRTABLE_RECORDS_CONNECTOR_ADAPTER.prepare({
        contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
        operation: AIRTABLE_LIST_RECORDS_OPERATION,
        parameters: { baseId: 'appBase123', tableId: 'tblTable123' },
        signal: signal()
      })
    ).resolves.toEqual({
      url: 'https://api.airtable.com/v0/appBase123/tblTable123?pageSize=100'
    })

    for (const parameters of [
      { baseId: '../other', tableId: 'tblTable123' },
      { baseId: 'appBase123', tableId: 'Table name' },
      { baseId: 'appBase123', tableId: 'tblTable123', pageSize: 101 },
      { baseId: 'appBase123', tableId: 'tblTable123', offset: 'bad offset?' },
      { baseId: 'appBase123', tableId: 'tblTable123', filterByFormula: 'TRUE()' }
    ]) {
      await expect(
        AIRTABLE_RECORDS_CONNECTOR_ADAPTER.prepare({
          contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
          operation: AIRTABLE_LIST_RECORDS_OPERATION,
          parameters,
          signal: signal()
        })
      ).rejects.toThrow()
    }

    const widenedOrigin = clonedContract()
    widenedOrigin.network.origins = ['https://example.com']
    await expect(
      AIRTABLE_RECORDS_CONNECTOR_ADAPTER.prepare({
        contract: widenedOrigin,
        operation: widenedOrigin.operations[0],
        parameters: { baseId: 'appBase123', tableId: 'tblTable123' },
        signal: signal()
      })
    ).rejects.toThrow('must be declared by the connector network policy')

    const widenedMethod = clonedContract()
    widenedMethod.network.methods = ['GET', 'POST']
    await expect(
      AIRTABLE_RECORDS_CONNECTOR_ADAPTER.prepare({
        contract: widenedMethod,
        operation: widenedMethod.operations[0],
        parameters: { baseId: 'appBase123', tableId: 'tblTable123' },
        signal: signal()
      })
    ).rejects.toThrow('authority does not match')
  })

  test('honors cancellation without preparing a request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      AIRTABLE_RECORDS_CONNECTOR_ADAPTER.prepare({
        contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
        operation: AIRTABLE_LIST_RECORDS_OPERATION,
        parameters: { baseId: 'appBase123', tableId: 'tblTable123' },
        signal: controller.signal
      })
    ).rejects.toThrow('cancelled')
  })

  test('normalizes arbitrary record fields into sorted bounded name/valueJson entries', () => {
    const result = normalizeAirtableListRecordsResponse({
      records: [sampleRecord()],
      offset: 'itrNext123/recRecord123'
    })

    expect(result).toEqual({
      records: [
        {
          id: 'recRecord123',
          createdTime: '2026-08-09T01:02:03.000Z',
          fields: [
            { name: 'Meta', valueJson: '{"a":1,"z":true}' },
            { name: 'Name', valueJson: '"Ada"' },
            { name: 'Tags', valueJson: '["design","review"]' }
          ]
        }
      ],
      hasMore: true,
      offset: 'itrNext123/recRecord123'
    })
    expect(
      AIRTABLE_RECORDS_CONNECTOR_ADAPTER.normalizeListRecordsResponse({ records: [] })
    ).toEqual({ records: [], hasMore: false })
  })

  test('uses the adapter response hook before the declared bounded result gate', async () => {
    const transformed = await AIRTABLE_RECORDS_CONNECTOR_ADAPTER.transformResponse?.(
      { records: [sampleRecord({ fields: { Count: 3 } })] },
      {
        contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
        operation: AIRTABLE_LIST_RECORDS_OPERATION,
        parameters: { baseId: 'appBase123', tableId: 'tblTable123' },
        signal: signal()
      }
    )

    expect(transformed).toEqual({
      records: [
        {
          id: 'recRecord123',
          createdTime: '2026-08-09T01:02:03.000Z',
          fields: [{ name: 'Count', valueJson: '3' }]
        }
      ],
      hasMore: false
    })
  })

  test('fails closed on oversized, accessor-backed, or widened responses', () => {
    expect(() =>
      normalizeAirtableListRecordsResponse({
        records: Array.from({ length: AIRTABLE_RECORDS_LIMITS.records + 1 }, () => sampleRecord())
      })
    ).toThrow('100-item limit')

    expect(() =>
      normalizeAirtableListRecordsResponse({
        records: [
          sampleRecord({
            fields: { Huge: 'x'.repeat(AIRTABLE_RECORDS_LIMITS.fieldValueJsonBytes + 1) }
          })
        ]
      })
    ).toThrow('field JSON byte limit')

    expect(() => normalizeAirtableListRecordsResponse({ records: [], unexpected: true })).toThrow(
      'unexpected is not supported'
    )

    const records = [sampleRecord()]
    Object.defineProperty(records, '00', { enumerable: true, value: sampleRecord() })
    expect(() => normalizeAirtableListRecordsResponse({ records })).toThrow(
      'must not contain custom fields'
    )

    let getterCalls = 0
    const record = Object.defineProperty(sampleRecord(), 'fields', {
      enumerable: true,
      get() {
        getterCalls += 1
        return {}
      }
    })
    expect(() => normalizeAirtableListRecordsResponse({ records: [record] })).toThrow(
      'enumerable data field'
    )
    expect(getterCalls).toBe(0)
  })

  test('does not invoke operation getters or toJSON while rejecting untrusted authority', async () => {
    let getterCalls = 0
    let toJSONCalls = 0
    const operation = Object.defineProperty(
      {
        ...AIRTABLE_LIST_RECORDS_OPERATION,
        toJSON() {
          toJSONCalls += 1
          return AIRTABLE_LIST_RECORDS_OPERATION
        }
      },
      'name',
      {
        enumerable: true,
        get() {
          getterCalls += 1
          return 'Unsafe'
        }
      }
    )

    await expect(
      AIRTABLE_RECORDS_CONNECTOR_ADAPTER.prepare({
        contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
        operation: operation as never,
        parameters: { baseId: 'appBase123', tableId: 'tblTable123' },
        signal: signal()
      })
    ).rejects.toThrow()
    expect(getterCalls).toBe(0)
    expect(toJSONCalls).toBe(0)
  })
})
