import type {
  BackendArtifactSourceV2,
  BackendProviderAdapterSlotV2,
  BackendProviderAdapterV2,
  BackendProviderBundleV2,
  BackendProviderDescriptorV2,
  BackendProviderOutputKindV2
} from '@open-pencil/compiler'
import {
  lowerBackendApplicationSpecV1ToV2,
  type BackendApplicationSpecV1,
  type BackendApplicationSpecV2,
  type BackendCapabilityV2
} from '@open-pencil/lowcode/backend'

export const FAKE_PACKAGE_DIGEST_V2 = `sha256:${'A'.repeat(43)}`

export function fakeBackendApplicationV2(): BackendApplicationSpecV2 {
  const source: BackendApplicationSpecV1 = {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'test.application-v2',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'notes',
          name: 'notes',
          management: 'managed',
          fields: [
            {
              id: 'id',
              name: 'id',
              type: 'uuid',
              nullable: false,
              default: { kind: 'generated', generator: 'uuid' }
            }
          ],
          primaryKey: { fields: ['id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [{ capability: 'migrations.schema', required: true }],
    secrets: []
  }
  const lowered = lowerBackendApplicationSpecV1ToV2(source)
  if (!lowered.ok) throw new Error(JSON.stringify(lowered.diagnostics))
  return structuredClone(lowered.value)
}

export interface FakeProviderOptionsV2 {
  readonly slot?: BackendProviderAdapterSlotV2
  readonly capabilities?: readonly BackendCapabilityV2[]
  readonly outputs?: readonly BackendProviderOutputKindV2[]
  readonly artifacts?: readonly BackendArtifactSourceV2[]
  readonly adapter?: Partial<BackendProviderAdapterV2>
}

export function createFakeBackendProviderBundleV2(
  options: FakeProviderOptionsV2 = {}
): BackendProviderBundleV2 {
  const slot = options.slot ?? 'migrations'
  const capabilities = [...(options.capabilities ?? ['migrations.schema'])].sort((left, right) =>
    left.localeCompare(right, 'en')
  )
  const outputs = [...(options.outputs ?? ['database-schema'])].sort((left, right) =>
    left.localeCompare(right, 'en')
  )
  const artifacts =
    options.artifacts ??
    ([
      {
        path: 'backend/v2/schema.sql',
        kind: 'database-schema',
        mediaType: 'application/sql',
        content: '-- deterministic schema v2\n'
      }
    ] satisfies readonly BackendArtifactSourceV2[])
  const descriptor: BackendProviderDescriptorV2 = {
    pluginId: 'open-pencil.fake-backend-v2',
    contributionId: 'fake-backend-v2',
    providerId: 'fake-v2',
    adapterId: 'open-pencil.fake-backend-v2',
    adapterVersion: '2.0.0',
    contractVersion: 2,
    supportedModelVersions: [2],
    capabilities,
    outputs
  }
  const adapter: BackendProviderAdapterV2 = {
    capabilities,
    outputs,
    validate() {
      return []
    },
    plan(context) {
      return {
        actualCapabilities: context.actualCapabilities,
        applicationId: context.application.applicationId,
        target: context.target
      }
    },
    emit() {
      return [...artifacts].reverse()
    },
    ...options.adapter
  }
  return { descriptor, [slot]: adapter }
}

export function fakeSelectionV2(bundle: BackendProviderBundleV2) {
  return {
    descriptor: bundle.descriptor,
    packageDigest: FAKE_PACKAGE_DIGEST_V2,
    enabled: true
  } as const
}
