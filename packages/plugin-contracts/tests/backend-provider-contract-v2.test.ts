import { describe, expect, test } from 'bun:test'

import { parsePluginBackendProviderContribution } from '../src/backend-provider-contract'
import {
  PLUGIN_BACKEND_PROVIDER_CAPABILITIES_V2,
  PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2,
  PLUGIN_BACKEND_PROVIDER_MODEL_VERSION_V2,
  parsePluginBackendProviderContributionV2,
  parseVersionedPluginBackendProviderContribution,
  type PluginBackendProviderContributionV2
} from '../src/backend-provider-contract-v2'
import { pluginBackendProviderContribution } from './helpers'

function providerV2(): PluginBackendProviderContributionV2 {
  return {
    providerId: 'supabase',
    contributionId: 'supabase.backend-v2',
    name: 'Supabase Backend V2',
    description: 'Emits reviewed backend artifacts through a trusted compiler adapter.',
    adapterId: 'open-pencil.backend.supabase-v2',
    contractVersion: PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION_V2,
    supportedModelVersions: [1, PLUGIN_BACKEND_PROVIDER_MODEL_VERSION_V2],
    capabilities: PLUGIN_BACKEND_PROVIDER_CAPABILITIES_V2,
    configuration: {
      schema: {
        type: 'object',
        properties: {
          options: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              strategy: { type: 'string', enum: ['durable', 'strict-v2'] }
            },
            additionalProperties: false
          },
          projectRef: { type: 'string', minLength: 1, maxLength: 64 },
          region: { type: 'string', enum: ['ap-southeast-1', 'us-east-1'] }
        },
        required: ['projectRef', 'region'],
        additionalProperties: false
      },
      maxBytes: 512
    },
    outputKinds: [
      'client-config',
      'database-schema',
      'deployment-manifest',
      'migration-plan',
      'security-policy',
      'server-runtime'
    ],
    permissions: []
  }
}

function errorFor(value: unknown): string {
  try {
    parsePluginBackendProviderContributionV2(value)
  } catch (cause) {
    if (cause instanceof TypeError) return cause.message
    throw cause
  }
  throw new Error('Expected Backend Provider v2 parsing to fail')
}

describe('backend provider declaration contract v2', () => {
  test('accepts the complete P2 capability vocabulary as inert support claims', () => {
    const contribution = providerV2()
    const parsed = parsePluginBackendProviderContributionV2(contribution)

    expect(parsed).toEqual(contribution)
    expect(parsed).not.toBe(contribution)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.capabilities)).toBe(true)
    expect(Object.isFrozen(parsed.supportedModelVersions)).toBe(true)
    expect(parsed.capabilities).toContain('realtime.subscribe')
    expect(parsed.capabilities).toContain('transactions.atomic')
    expect(parsed.capabilities).toContain('migrations.backfill')
    expect(parsed.capabilities).toContain('jobs.schedule')
    expect(parsed.capabilities).toContain('queues.consume')
    expect(parsed.capabilities).toContain('queues.publish')
    expect(parsed.capabilities).toContain('webhooks.receive')
    expect(parsed.capabilities).toContain('webhooks.deliver')
    expect(parsed.capabilities).toContain('workflows.idempotency')
    expect(parsed.capabilities).toContain('workflows.retry')
    expect(parsed.capabilities).toContain('observability.logs')
    expect(parsed.capabilities).toContain('observability.metrics')
    expect(parsed.capabilities).toContain('observability.traces')
    expect(parsed.capabilities).toContain('drift.detect')
    expect(parsed.capabilities).toContain('events.data-change')
    expect(parsed.capabilities).toContain('audit.events')
  })

  test('supports a model-v2-only provider and requires model v2', () => {
    const v2Only = structuredClone(providerV2())
    Reflect.set(v2Only, 'supportedModelVersions', [2])
    expect(parsePluginBackendProviderContributionV2(v2Only).supportedModelVersions).toEqual([2])

    for (const versions of [[], [1], [2, 1], [1, 1], [1, 2, 3]]) {
      const contribution = structuredClone(providerV2())
      Reflect.set(contribution, 'supportedModelVersions', versions)
      expect(() => parsePluginBackendProviderContributionV2(contribution)).toThrow()
    }
  })

  test('keeps contract v1 parsing byte-compatible and version-separated', () => {
    const v1 = pluginBackendProviderContribution()
    const before = JSON.stringify(v1)
    expect(parsePluginBackendProviderContribution(v1)).toEqual(v1)
    expect(parseVersionedPluginBackendProviderContribution(v1)).toEqual(v1)
    expect(parseVersionedPluginBackendProviderContribution(providerV2())).toEqual(providerV2())
    expect(JSON.stringify(v1)).toBe(before)
    expect(() => parsePluginBackendProviderContributionV2(v1)).toThrow('contractVersion')
    expect(() => parsePluginBackendProviderContribution(providerV2())).toThrow('contractVersion')

    const unknown = structuredClone(providerV2())
    Reflect.set(unknown, 'contractVersion', 3)
    expect(() => parseVersionedPluginBackendProviderContribution(unknown)).toThrow(
      'contractVersion'
    )
  })

  test('rejects unknown, duplicate, unsorted, or empty capability claims', () => {
    const cases: readonly unknown[][] = [
      [],
      ['network.fetch'],
      ['data.read', 'data.read'],
      ['data.write', 'data.read']
    ]
    for (const capabilities of cases) {
      const contribution = structuredClone(providerV2())
      Reflect.set(contribution, 'capabilities', capabilities)
      expect(() => parsePluginBackendProviderContributionV2(contribution)).toThrow()
    }
  })

  test('never accepts permission, endpoint, credential, executable, or Apply authority', () => {
    for (const authority of [
      'network',
      'credentials',
      'filesystem',
      'process',
      'apply',
      'deploy'
    ]) {
      const contribution = structuredClone(providerV2())
      Reflect.set(contribution, 'permissions', [authority])
      expect(() => parsePluginBackendProviderContributionV2(contribution)).toThrow(
        'more than 0 entries'
      )
    }

    for (const field of ['endpoint', 'credential', 'token', 'sql', 'executor', 'apply', 'deploy']) {
      const contribution = structuredClone(providerV2())
      Reflect.set(contribution, field, 'untrusted')
      expect(() => parsePluginBackendProviderContributionV2(contribution)).toThrow(
        'unsupported fields'
      )
    }

    for (const propertyName of [
      'endpoint',
      'apiOrigin',
      'accessToken',
      'serviceRoleKey',
      'migrationSql',
      'deployCommand',
      'executorScript'
    ]) {
      const contribution = structuredClone(providerV2())
      Reflect.set(contribution.configuration.schema.properties, propertyName, { type: 'string' })
      expect(() => parsePluginBackendProviderContributionV2(contribution)).toThrow(
        'must not request endpoint, credential, code, or command authority'
      )
    }

    const executable = structuredClone(providerV2())
    const unsafeDescription = 'Run DROP TABLE customer_records and deploy production'
    Reflect.set(executable, 'description', unsafeDescription)
    const message = errorFor(executable)
    expect(message).toContain('inert data text')
    expect(message).not.toContain(unsafeDescription)
  })

  test('rejects non-data descriptors without invoking accessors', () => {
    let getterCalls = 0
    const accessor = structuredClone(providerV2())
    Object.defineProperty(accessor, 'adapterId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'hostile.adapter'
      }
    })
    expect(() => parsePluginBackendProviderContributionV2(accessor)).toThrow(
      'enumerable data property'
    )
    expect(getterCalls).toBe(0)

    const versionAccessor = structuredClone(providerV2())
    Object.defineProperty(versionAccessor, 'contractVersion', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 2
      }
    })
    expect(() => parseVersionedPluginBackendProviderContribution(versionAccessor)).toThrow(
      'enumerable data property'
    )
    expect(getterCalls).toBe(0)
  })
})
