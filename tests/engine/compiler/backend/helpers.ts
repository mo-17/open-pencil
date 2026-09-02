import type {
  BackendArtifactSource,
  BackendProviderAdapter,
  BackendProviderAdapterSlot,
  BackendProviderBundle,
  BackendProviderDescriptor,
  BackendProviderOutputKind
} from '@open-pencil/compiler'
import type {
  BackendApplicationSpecV1,
  BackendCapability,
  BackendSecretRef
} from '@open-pencil/lowcode/backend'

export const FAKE_PACKAGE_DIGEST = `sha256:${'A'.repeat(43)}`

export function fakeBackendApplication(
  capabilities: readonly BackendCapability[] = ['data.read', 'data.write'],
  secrets: readonly BackendSecretRef[] = []
): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'test.application',
    dataModel: {
      version: 1,
      entities: [],
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
    workflows: {
      version: 1,
      workflows: []
    },
    capabilities: capabilities.map((capability) => ({ capability, required: true })),
    secrets: [...secrets]
  }
}

export interface FakeProviderOptions {
  readonly slot?: BackendProviderAdapterSlot
  readonly capabilities?: readonly BackendCapability[]
  readonly outputs?: readonly BackendProviderOutputKind[]
  readonly artifacts?: readonly BackendArtifactSource[]
}

export function createFakeBackendProviderBundle(
  options: FakeProviderOptions = {}
): BackendProviderBundle {
  const slot = options.slot ?? 'data'
  const capabilities = [...(options.capabilities ?? ['data.read', 'data.write'])].sort()
  const outputs = [...(options.outputs ?? ['database-schema', 'client-config'])].sort()
  const artifacts =
    options.artifacts ??
    ([
      {
        path: 'backend/schema.json',
        kind: 'database-schema',
        mediaType: 'application/json',
        content: '{"entities":[]}\n'
      },
      {
        path: 'src/backend/config.json',
        kind: 'client-config',
        mediaType: 'application/json',
        content: '{"provider":"fake"}\n'
      }
    ] satisfies readonly BackendArtifactSource[])
  const descriptor: BackendProviderDescriptor = {
    pluginId: 'open-pencil.fake-backend',
    contributionId: 'fake-backend',
    providerId: 'fake',
    adapterId: 'open-pencil.fake-backend-v1',
    adapterVersion: '1.0.0',
    contractVersion: 1,
    supportedModelVersions: [1],
    capabilities,
    outputs
  }
  const adapter: BackendProviderAdapter = {
    capabilities,
    outputs,
    validate() {
      return []
    },
    plan(context) {
      return {
        applicationId: context.application.applicationId,
        capabilities: context.capabilities
          .filter((decision) => decision.included)
          .map((decision) => decision.capability),
        target: context.target
      }
    },
    emit() {
      return [...artifacts].reverse()
    }
  }
  return {
    descriptor,
    [slot]: adapter
  }
}

export function fakeSelection(bundle: BackendProviderBundle) {
  return {
    descriptor: bundle.descriptor,
    packageDigest: FAKE_PACKAGE_DIGEST,
    enabled: true
  } as const
}
