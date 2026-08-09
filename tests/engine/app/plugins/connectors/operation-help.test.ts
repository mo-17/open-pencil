import { describe, expect, test } from 'bun:test'

import type {
  PluginConnectorContractV1,
  PluginConnectorOperationV1,
  PluginObjectParameterSchemaV2
} from '@open-pencil/core/plugins'

import {
  AIRTABLE_RECORDS_CONNECTOR_ADAPTER,
  AIRTABLE_RECORDS_CONNECTOR_CONTRACT
} from '@/app/plugins/connectors/airtable-records'
import {
  CONNECTOR_OPERATION_HELP_LIMITS,
  connectorOperationHelp
} from '@/app/plugins/connectors/operation/help'
import { parseConnectorOperationParameters } from '@/app/plugins/connectors/operation/runner-model'
import {
  RESEND_EMAIL_CONNECTOR_ADAPTER,
  RESEND_EMAIL_CONNECTOR_CONTRACT
} from '@/app/plugins/connectors/resend-email'
import {
  STRIPE_BILLING_CONNECTOR_ADAPTER,
  STRIPE_BILLING_CONNECTOR_CONTRACT
} from '@/app/plugins/connectors/stripe-billing'
import {
  SUPABASE_BUSINESS_CONNECTOR_ADAPTER,
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT
} from '@/app/plugins/connectors/supabase-business'
import {
  SUPABASE_SCHEMA_INSPECTOR_ADAPTER,
  SUPABASE_SCHEMA_INSPECTOR_CONTRACT
} from '@/app/plugins/connectors/supabase-schema-inspector'
import type { ConnectorHostAdapter } from '@/app/plugins/connectors/types'

const MUTATION_ATTEMPT_ID = '638acdad-eb0d-4115-adc3-894510531332'

const BUNDLED_CONNECTORS: readonly Readonly<{
  contract: PluginConnectorContractV1
  adapter: ConnectorHostAdapter
}>[] = Object.freeze([
  {
    contract: SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
    adapter: SUPABASE_SCHEMA_INSPECTOR_ADAPTER
  },
  { contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT, adapter: AIRTABLE_RECORDS_CONNECTOR_ADAPTER },
  { contract: SUPABASE_BUSINESS_CONNECTOR_CONTRACT, adapter: SUPABASE_BUSINESS_CONNECTOR_ADAPTER },
  { contract: STRIPE_BILLING_CONNECTOR_CONTRACT, adapter: STRIPE_BILLING_CONNECTOR_ADAPTER },
  { contract: RESEND_EMAIL_CONNECTOR_CONTRACT, adapter: RESEND_EMAIL_CONNECTOR_ADAPTER }
])

describe('connector operation help', () => {
  test('flattens nested fields with relative required state, enums, item types, and bounds', () => {
    const nestedSchema: PluginObjectParameterSchemaV2 = {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          title: 'Status title',
          description: 'Status description',
          enum: ['open', 'closed'],
          minLength: 4,
          maxLength: 6
        },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 1 } },
            required: ['name'],
            additionalProperties: false
          },
          minItems: 1,
          maxItems: 5
        }
      },
      required: ['status'],
      additionalProperties: false
    }
    const operation: PluginConnectorOperationV1 = {
      ...SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0],
      operationId: 'third-party-operation',
      parameters: { schema: nestedSchema, maxBytes: 2_048 }
    }
    const help = connectorOperationHelp('third-party.plugin', operation, 'zh-CN')

    expect(help.exampleJson).toBeNull()
    expect(help.truncated).toBe(false)
    expect(help.fields).toMatchObject([
      {
        path: 'status',
        type: 'string',
        itemType: null,
        required: true,
        label: 'Status title',
        description: 'Status description',
        enumValues: ['open', 'closed'],
        bounds: { minLength: 4, maxLength: 6 },
        itemEnumValues: [],
        itemBounds: null,
        constraintTokens: ['enum=open|closed', 'minLength=4', 'maxLength=6']
      },
      {
        path: 'rows',
        type: 'array',
        itemType: 'object',
        required: false,
        label: 'rows',
        description: 'array',
        bounds: { minItems: 1, maxItems: 5 },
        itemBounds: {}
      },
      {
        path: 'rows[].name',
        type: 'string',
        required: true,
        label: 'name',
        description: 'string',
        bounds: { minLength: 1 }
      }
    ])
  })

  test('bounds the field guide even for a deeply populated valid-shape schema', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `group${index}`,
        {
          type: 'object' as const,
          properties: {
            first: { type: 'string' as const },
            second: { type: 'string' as const }
          },
          additionalProperties: false as const
        }
      ])
    )
    const operation: PluginConnectorOperationV1 = {
      ...SUPABASE_SCHEMA_INSPECTOR_CONTRACT.operations[0],
      operationId: 'large-help',
      parameters: {
        schema: { type: 'object', properties, additionalProperties: false },
        maxBytes: 32_768
      }
    }
    const help = connectorOperationHelp('third-party.plugin', operation, 'en-US')
    expect(help.fields).toHaveLength(CONNECTOR_OPERATION_HELP_LIMITS.maxFields)
    expect(help.truncated).toBe(true)
  })

  test('keeps scalar array item enums and bounds visible on their owning JSON path', () => {
    const query = SUPABASE_BUSINESS_CONNECTOR_CONTRACT.operations.find(
      ({ operationId }) => operationId === 'query-rows'
    )
    if (!query) throw new Error('Missing Supabase query fixture')
    const columns = connectorOperationHelp(
      SUPABASE_BUSINESS_CONNECTOR_CONTRACT.pluginId,
      query,
      'en-US'
    ).fields.find(({ path }) => path === 'columns')
    expect(columns).toMatchObject({
      type: 'array',
      itemType: 'string',
      itemBounds: { minLength: 1, maxLength: 63 }
    })
    expect(columns?.constraintTokens).toEqual([
      'minItems=1',
      'maxItems=64',
      'items.minLength=1',
      'items.maxLength=63'
    ])
  })

  test('provides reviewed bilingual field copy and a valid prepared example for every bundled operation', async () => {
    let operationCount = 0
    for (const { contract, adapter } of BUNDLED_CONNECTORS) {
      for (const operation of contract.operations) {
        operationCount += 1
        const english = connectorOperationHelp(contract.pluginId, operation, 'en-US')
        const chinese = connectorOperationHelp(contract.pluginId, operation, 'zh-CN')
        expect(english.exampleJson, `${contract.pluginId}/${operation.operationId}`).not.toBeNull()
        expect(chinese.exampleJson).toBe(english.exampleJson)
        expect(english.fields.every((field) => field.description !== field.type)).toBe(true)
        expect(chinese.fields.every((field) => field.description !== field.type)).toBe(true)
        expect(chinese.fields.some((field) => /[\u3400-\u9fff]/u.test(field.description))).toBe(
          true
        )

        const parsed = parseConnectorOperationParameters(english.exampleJson ?? '', operation)
        await expect(
          adapter.prepare({
            contract,
            operation,
            parameters: parsed.parameters,
            mutationAttemptId: MUTATION_ATTEMPT_ID,
            signal: new AbortController().signal
          })
        ).resolves.toBeDefined()
      }
    }
    expect(operationCount).toBe(11)
  })

  test('keeps example fill DOM-only and never renders schema text as HTML', async () => {
    const source = await Bun.file(
      new URL(
        '../../../../../src/components/settings/plugins/PluginConnectorOperationRunner.vue',
        import.meta.url
      )
    ).text()
    expect(source).not.toContain('v-html')
    expect(source).toContain('@click="fillOperationExample"')
    const fillStart = source.indexOf('function fillOperationExample')
    const fillEnd = source.indexOf('function operationFieldType', fillStart)
    const fillSource = source.slice(fillStart, fillEnd)
    expect(fillSource).toContain('parametersInput.value.value = operation.help.exampleJson')
    expect(fillSource).not.toContain('executeInstalledAppConnector')
    expect(fillSource).not.toContain('parseConnectorOperationParameters')
  })
})
