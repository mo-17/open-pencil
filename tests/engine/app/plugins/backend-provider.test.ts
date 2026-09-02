import { describe, expect, test } from 'bun:test'

import { withDefaults, type CompilerBackendProviderRequest } from '@open-pencil/compiler'
import {
  BACKEND_ARTIFACT_MANIFEST_PATH,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR
} from '@open-pencil/compiler/backend'
import { digestCanonicalManifest, SceneGraph } from '@open-pencil/scene-graph'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppBundlePluginCatalogEntry,
  type InstalledPluginBackendProvider
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_MCP_OPERATIONS,
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_ADAPTER_ID,
  SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION,
  SUPABASE_BACKEND_PROVIDER_CONTRIBUTION,
  SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID,
  SUPABASE_BACKEND_PROVIDER_ID,
  SUPABASE_BACKEND_PROVIDER_PACKAGE_DIGEST,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  appBackendProviderDocumentValue,
  compileAppBackendProviderDocument,
  inspectInstalledBackendProviderCompatibility,
  isAppBackendProviderMCPOperation,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderCompilerOptions,
  resolveAppBackendProviderDescriptor,
  resolveAppBackendProviderReleaseAuthority,
  type AppBackendProviderDescriptor,
  type AppBackendProviderHostStore
} from '@/app/plugins/host/backend-provider'

const ENGINE_VERSION = '0.13.2'

function stripeSecretCanary(suffix: string): string {
  return ['sk', 'live', suffix].join('_')
}

function bundledBackendProvider(): AppBundlePluginCatalogEntry {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (entry?.trustSource !== 'app-bundle') {
    throw new Error('Missing bundled Supabase backend provider')
  }
  return entry
}

async function activeProvider() {
  const storage = createMemoryAppPluginStateStorage()
  const store = createAppPluginStore({
    storage,
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: ENGINE_VERSION
  })
  const snapshot = await store.load()
  expect(snapshot.error).toBeNull()
  const installed = store.backendProvider(
    SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
    SUPABASE_BACKEND_PROVIDER_ID
  )
  if (!installed) throw new Error('Expected active Supabase backend provider')
  return { installed, storage, store }
}

function changedInstalled(
  installed: InstalledPluginBackendProvider,
  change: (value: InstalledPluginBackendProvider) => void
): InstalledPluginBackendProvider {
  const value = structuredClone(installed)
  change(value)
  return value
}

function hostStore(installed: InstalledPluginBackendProvider): AppBackendProviderHostStore {
  return { installedBackendProviders: () => [structuredClone(installed)] }
}

function onlyDescriptor(store: AppBackendProviderHostStore) {
  const descriptors = listAppBackendProviderDescriptors(store)
  if (descriptors.length !== 1) throw new Error('Expected one reviewed backend provider descriptor')
  return descriptors[0]
}

function changedDescriptor(
  descriptor: AppBackendProviderDescriptor,
  change: (value: AppBackendProviderDescriptor) => void
): AppBackendProviderDescriptor {
  const value = structuredClone(descriptor)
  change(value)
  return value
}

function emptyBackendApplication() {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'host-boundary-test',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [],
    secrets: []
  }
}

function providerDocumentGraph(descriptor: AppBackendProviderDescriptor): SceneGraph {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    pluginData: [
      {
        pluginId: 'open-pencil',
        key: 'lowcode/backendProvider.v1',
        value: appBackendProviderDocumentValue({
          format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
          selection: descriptor,
          application: {
            ...emptyBackendApplication(),
            capabilities: [
              { capability: 'data.read', required: true },
              { capability: 'policy.row-level', required: true }
            ]
          }
        })
      }
    ]
  })
  return graph
}

function thrownCode(operation: () => unknown): unknown {
  try {
    operation()
  } catch (cause) {
    return cause && typeof cause === 'object' ? Reflect.get(cause, 'code') : undefined
  }
  return undefined
}

describe('backend provider plugin host boundary', () => {
  test('publishes one inert built-in Supabase declaration through the ordinary lifecycle', async () => {
    const entry = bundledBackendProvider()
    expect(entry).toMatchObject({
      installedByDefault: true,
      enabledByDefault: true,
      manifest: {
        schemaVersion: 2,
        plugin: { id: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, version: '1.0.0' },
        publisher: { id: 'open-pencil', keyId: 'app-bundle-v1' },
        contributions: {
          modules: [],
          backendProviders: [SUPABASE_BACKEND_PROVIDER_CONTRIBUTION]
        }
      }
    })

    const { store } = await activeProvider()
    expect(store.installedBackendProviders()).toHaveLength(1)
    const descriptor = onlyDescriptor(store)
    expect(descriptor).toMatchObject({
      descriptorVersion: 1,
      pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
      contributionId: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID,
      providerId: SUPABASE_BACKEND_PROVIDER_ID,
      adapterId: SUPABASE_BACKEND_PROVIDER_ADAPTER_ID,
      adapterVersion: SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION,
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION.capabilities,
      outputKinds: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION.outputKinds,
      permissions: [],
      packageAuthority: {
        trustSource: 'app-bundle',
        publisherId: 'open-pencil',
        publisherKeyId: 'app-bundle-v1',
        pinnedDigest: null,
        marketplaceAuthority: null
      }
    })
    expect(descriptor.packageAuthority.packageDigest).toBe(SUPABASE_BACKEND_PROVIDER_PACKAGE_DIGEST)
    expect(SUPABASE_BACKEND_PROVIDER_PACKAGE_DIGEST).toBe(
      `app-bundle-sha256:${await digestCanonicalManifest(entry.manifest)}`
    )
    expect({
      pluginId: descriptor.pluginId,
      contributionId: descriptor.contributionId,
      providerId: descriptor.providerId,
      adapterId: descriptor.adapterId,
      adapterVersion: descriptor.adapterVersion,
      contractVersion: descriptor.contractVersion,
      supportedModelVersions: descriptor.supportedModelVersions,
      capabilities: descriptor.capabilities,
      outputs: descriptor.outputKinds
    }).toEqual(SUPABASE_BACKEND_PROVIDER_DESCRIPTOR)
    expect(resolveAppBackendProviderReleaseAuthority(store, descriptor)).toEqual({
      publisherId: 'open-pencil',
      packageDigest: SUPABASE_BACKEND_PROVIDER_PACKAGE_DIGEST,
      pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
      contributionId: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID,
      providerId: SUPABASE_BACKEND_PROVIDER_ID,
      adapterId: SUPABASE_BACKEND_PROVIDER_ADAPTER_ID,
      adapterVersion: SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION,
      contractVersion: 1,
      supportedModelVersions: [1],
      capabilities: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION.capabilities,
      permissions: [],
      outputKinds: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION.outputKinds
    })

    await store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, false)
    expect(store.installedBackendProviders()).toEqual([])
    expect(store.backendProvider(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, 'supabase')).toBeNull()
    expect(listAppBackendProviderDescriptors(store)).toEqual([])
    expect(resolveAppBackendProviderDescriptor(store, descriptor)).toBeNull()

    await store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, true)
    expect(store.installedBackendProviders()).toHaveLength(1)
    expect(resolveAppBackendProviderDescriptor(store, descriptor)).not.toBeNull()

    await store.uninstall(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID)
    expect(store.installedBackendProviders()).toEqual([])
    expect(listAppBackendProviderDescriptors(store)).toEqual([])
  })

  test('rejects secret-like and unknown selection data before document serialization without echo', async () => {
    const { store } = await activeProvider()
    const descriptor = onlyDescriptor(store)
    const request = {
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: emptyBackendApplication()
    }
    expect(JSON.parse(appBackendProviderDocumentValue(request))).toMatchObject({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: { pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID }
    })

    const canary = stripeSecretCanary('HostDocumentCanary1234567890')
    const secretValue = structuredClone(descriptor)
    ;(secretValue as { pluginId: string }).pluginId = canary
    const secretKey = structuredClone(descriptor)
    Object.defineProperty(secretKey, canary, {
      value: 'ordinary-value',
      enumerable: true,
      configurable: true,
      writable: true
    })
    const unknownField = {
      ...structuredClone(descriptor),
      unsupportedSelectionField: 'ordinary-value'
    }

    for (const selection of [secretValue, secretKey, unknownField]) {
      let caught: unknown
      try {
        appBackendProviderDocumentValue({ ...request, selection })
      } catch (cause) {
        caught = cause
      }
      expect(caught).toBeInstanceOf(Error)
      expect(String(caught)).toContain('Backend Provider selection is invalid.')
      expect(String(caught)).not.toContain(canary)
      expect(JSON.stringify(caught)).not.toContain(canary)
    }
  })

  test('returns detached recursively frozen descriptor snapshots and rejects mutated copies', async () => {
    const { store } = await activeProvider()
    const descriptors = listAppBackendProviderDescriptors(store)
    const descriptor = descriptors[0]
    if (!descriptor) throw new Error('Expected one backend provider descriptor')
    const configurationSchema = descriptor.configuration.schema as {
      readonly properties: Readonly<Record<string, unknown>>
      readonly maxProperties: number
    }

    expect(Object.isFrozen(descriptors)).toBe(true)
    for (const value of [
      descriptor,
      descriptor.packageAuthority,
      descriptor.supportedModelVersions,
      descriptor.capabilities,
      descriptor.configuration,
      descriptor.configuration.schema,
      configurationSchema.properties,
      descriptor.outputKinds,
      descriptor.permissions,
      descriptor.mcp,
      descriptor.mcp.operations
    ]) {
      expect(Object.isFrozen(value)).toBe(true)
    }

    const nextDescriptor = onlyDescriptor(store)
    expect(nextDescriptor).not.toBe(descriptor)
    expect(nextDescriptor.configuration).not.toBe(descriptor.configuration)
    expect(nextDescriptor.capabilities).not.toBe(descriptor.capabilities)
    expect(nextDescriptor.outputKinds).not.toBe(descriptor.outputKinds)

    expect(() => {
      ;(configurationSchema as { maxProperties: number }).maxProperties = 1
    }).toThrow()
    const mutated = structuredClone(descriptor)
    ;(mutated.configuration.schema as { maxProperties: number }).maxProperties = 1
    expect(resolveAppBackendProviderDescriptor(store, mutated)).toBeNull()
    expect(resolveAppBackendProviderReleaseAuthority(store, mutated)).toBeNull()
  })

  test('requires the exact host-reviewed publisher, plugin, declaration, and package authority', async () => {
    const { installed } = await activeProvider()
    expect(inspectInstalledBackendProviderCompatibility(installed)).toMatchObject({
      ok: true,
      status: 'compatible'
    })

    const wrongPublisher = changedInstalled(installed, (value) => {
      ;(value.plugin.package.manifest.publisher as { id: string }).id = 'attacker'
    })
    expect(inspectInstalledBackendProviderCompatibility(wrongPublisher)).toMatchObject({
      ok: false,
      status: 'publisher-mismatch'
    })

    const wrongPublisherKey = changedInstalled(installed, (value) => {
      ;(value.plugin.package.manifest.publisher as { keyId: string }).keyId = 'app-bundle-rotated'
    })
    expect(inspectInstalledBackendProviderCompatibility(wrongPublisherKey)).toMatchObject({
      ok: false,
      status: 'publisher-key-mismatch'
    })

    const wrongPlugin = changedInstalled(installed, (value) => {
      ;(value.plugin.package.manifest.plugin as { id: string }).id = 'open-pencil.other-backend'
    })
    expect(inspectInstalledBackendProviderCompatibility(wrongPlugin)).toMatchObject({
      ok: false,
      status: 'plugin-identity-mismatch'
    })

    const wrongVersion = changedInstalled(installed, (value) => {
      ;(value.plugin.package.manifest.plugin as { version: string }).version = '1.0.1'
    })
    expect(inspectInstalledBackendProviderCompatibility(wrongVersion)).toMatchObject({
      ok: false,
      status: 'plugin-version-mismatch'
    })

    const wrongContribution = changedInstalled(installed, (value) => {
      ;(value.contribution as { contributionId: string }).contributionId = 'supabase.other'
      if (value.plugin.package.manifest.schemaVersion !== 2) throw new Error('Expected v2')
      const declared = value.plugin.package.manifest.contributions.backendProviders?.[0]
      ;(declared as { contributionId: string }).contributionId = 'supabase.other'
    })
    expect(inspectInstalledBackendProviderCompatibility(wrongContribution)).toMatchObject({
      ok: false,
      status: 'contribution-identity-mismatch'
    })

    const wrongProvider = changedInstalled(installed, (value) => {
      ;(value.contribution as { providerId: string }).providerId = 'other-provider'
      if (value.plugin.package.manifest.schemaVersion !== 2) throw new Error('Expected v2')
      const declared = value.plugin.package.manifest.contributions.backendProviders?.[0]
      ;(declared as { providerId: string }).providerId = 'other-provider'
    })
    expect(inspectInstalledBackendProviderCompatibility(wrongProvider)).toMatchObject({
      ok: false,
      status: 'contribution-identity-mismatch'
    })

    const wrongAdapter = changedInstalled(installed, (value) => {
      const contribution = value.contribution as { adapterId: string }
      contribution.adapterId = 'open-pencil.backend.unreviewed'
      if (value.plugin.package.manifest.schemaVersion !== 2) throw new Error('Expected v2')
      const declared = value.plugin.package.manifest.contributions.backendProviders?.[0]
      ;(declared as { adapterId: string }).adapterId = contribution.adapterId
    })
    expect(inspectInstalledBackendProviderCompatibility(wrongAdapter)).toMatchObject({
      ok: false,
      status: 'untrusted-adapter'
    })

    const broaderCapabilities = changedInstalled(installed, (value) => {
      const capabilities = [
        ...value.contribution.capabilities,
        'transactions.atomic'
      ] as typeof value.contribution.capabilities
      ;(value.contribution as { capabilities: typeof capabilities }).capabilities = capabilities
      if (value.plugin.package.manifest.schemaVersion !== 2) throw new Error('Expected v2')
      const declared = value.plugin.package.manifest.contributions.backendProviders?.[0]
      ;(declared as { capabilities: typeof capabilities }).capabilities = capabilities
    })
    expect(inspectInstalledBackendProviderCompatibility(broaderCapabilities)).toMatchObject({
      ok: false,
      status: 'declaration-mismatch'
    })

    const publisherPackage = changedInstalled(installed, (value) => {
      ;(value.plugin.package as { trustSource: string }).trustSource = 'publisher-signature'
    })
    expect(inspectInstalledBackendProviderCompatibility(publisherPackage)).toMatchObject({
      ok: false,
      status: 'trust-source-mismatch'
    })
  })

  test('rejects every substituted Provider descriptor authority field', async () => {
    const { store } = await activeProvider()
    const descriptor = onlyDescriptor(store)
    const substitutions = [
      changedDescriptor(descriptor, (value) => {
        ;(value.packageAuthority as { publisherKeyId: string }).publisherKeyId =
          'app-bundle-rotated'
      }),
      changedDescriptor(descriptor, (value) => {
        ;(value as { contributionId: string }).contributionId = 'supabase.other'
      }),
      changedDescriptor(descriptor, (value) => {
        ;(value as { providerId: string }).providerId = 'other-provider'
      }),
      changedDescriptor(descriptor, (value) => {
        ;(value as { adapterVersion: string }).adapterVersion = '2.0.0'
      }),
      changedDescriptor(descriptor, (value) => {
        ;(value as { supportedModelVersions: readonly [1] }).supportedModelVersions = [2] as never
      }),
      changedDescriptor(descriptor, (value) => {
        ;(value as { capabilities: readonly string[] }).capabilities = ['data.read']
      }),
      changedDescriptor(descriptor, (value) => {
        ;(value.configuration as { maxBytes: number }).maxBytes = 3
      }),
      changedDescriptor(descriptor, (value) => {
        ;(value as { outputKinds: readonly string[] }).outputKinds = ['database-schema']
      }),
      changedDescriptor(descriptor, (value) => {
        ;(value as { permissions: readonly string[] }).permissions = ['network']
      })
    ]

    for (const substituted of substitutions) {
      expect(resolveAppBackendProviderDescriptor(store, substituted)).toBeNull()
      expect(resolveAppBackendProviderReleaseAuthority(store, substituted)).toBeNull()
    }
  })

  test('invalidates stale digest, pin, blocked, and review authority without side effects', async () => {
    const { installed, storage, store } = await activeProvider()
    const expected = onlyDescriptor(store)

    const changedDigest = changedInstalled(installed, (value) => {
      ;(value.plugin.package as { digest: string }).digest = `app-bundle-sha256:${'A'.repeat(43)}`
    })
    expect(inspectInstalledBackendProviderCompatibility(changedDigest)).toMatchObject({
      ok: false,
      status: 'package-digest-mismatch'
    })
    expect(listAppBackendProviderDescriptors(hostStore(changedDigest))).toEqual([])
    expect(resolveAppBackendProviderDescriptor(hostStore(changedDigest), expected)).toBeNull()
    expect(resolveAppBackendProviderReleaseAuthority(hostStore(changedDigest), expected)).toBeNull()

    const pinMismatch = changedInstalled(installed, (value) => {
      ;(value.plugin as { pinnedDigest: string | null }).pinnedDigest =
        `app-bundle-sha256:${'B'.repeat(43)}`
    })
    expect(inspectInstalledBackendProviderCompatibility(pinMismatch)).toMatchObject({
      ok: false,
      status: 'digest-pin-mismatch'
    })
    expect(listAppBackendProviderDescriptors(hostStore(pinMismatch))).toEqual([])

    const blocked = changedInstalled(installed, (value) => {
      ;(value.plugin as { blockedReason?: string }).blockedReason =
        'Marketplace source authority changed; review again'
    })
    expect(listAppBackendProviderDescriptors(hostStore(blocked))).toEqual([])

    const foreignReviewAuthority = changedInstalled(installed, (value) => {
      ;(value.plugin.package as { marketplaceAuthority?: unknown }).marketplaceAuthority = {
        sourceId: 'marketplace',
        trustDomainId: 'other',
        sourceGeneration: 2,
        rootKeySpkiSha256: `sha256-${'A'.repeat(43)}`
      }
    })
    expect(listAppBackendProviderDescriptors(hostStore(foreignReviewAuthority))).toEqual([])

    let descriptorAccesses = 0
    const accessorDescriptor = structuredClone(expected)
    Object.defineProperty(accessorDescriptor, 'pluginId', {
      enumerable: true,
      get() {
        descriptorAccesses += 1
        return expected.pluginId
      }
    })
    expect(resolveAppBackendProviderDescriptor(store, accessorDescriptor)).toBeNull()
    expect(descriptorAccesses).toBe(0)

    await store.setPinned(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, true)
    const nextEntry = structuredClone(bundledBackendProvider())
    ;(nextEntry.manifest.plugin as { version: string }).version = '1.0.1'
    const reloaded = createAppPluginStore({
      storage,
      catalog: [nextEntry],
      activationCompatibilityPolicy: () => ({ ok: true }),
      engineVersion: ENGINE_VERSION
    })
    const snapshot = await reloaded.load()
    expect(snapshot.error?.message).toContain('pinned to a different app-bundle digest')
    expect(snapshot.pinnedDigestMismatches).toHaveLength(1)
    expect(reloaded.installedBackendProviders()).toEqual([])
    expect(listAppBackendProviderDescriptors(reloaded)).toEqual([])
  })

  test('injects one live Host-resolved request into ordinary Compiler plan/emit', async () => {
    const { store } = await activeProvider()
    const descriptor = onlyDescriptor(store)
    const graph = providerDocumentGraph(descriptor)
    const pageId = graph.getPages()[0].id
    const baseOptions = withDefaults({ devMode: false })
    const options = prepareAppBackendProviderCompilerOptions(store, graph, baseOptions)
    const publicRequest: CompilerBackendProviderRequest | undefined = options.backendProvider

    expect(publicRequest?.selection).toMatchObject({
      enabled: true,
      packageDigest: SUPABASE_BACKEND_PROVIDER_PACKAGE_DIGEST,
      descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR
    })
    const first = compileAppBackendProviderDocument(store, {
      graph,
      pageIds: [pageId],
      options: baseOptions
    })
    const second = compileAppBackendProviderDocument(store, {
      graph,
      pageIds: [pageId],
      options: baseOptions
    })
    const backendEntries = [...first.files]
      .filter(([path]) => path.startsWith('backend/') || path === BACKEND_ARTIFACT_MANIFEST_PATH)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
    expect(backendEntries.length).toBeGreaterThan(1)
    expect(
      [...second.files]
        .filter(([path]) => path.startsWith('backend/') || path === BACKEND_ARTIFACT_MANIFEST_PATH)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
    ).toEqual(backendEntries)
    const manifest = first.files.get(BACKEND_ARTIFACT_MANIFEST_PATH)
    if (typeof manifest !== 'string') throw new Error('Expected Backend artifact manifest')
    expect(JSON.parse(manifest)).toMatchObject({
      authority: { packageDigest: SUPABASE_BACKEND_PROVIDER_PACKAGE_DIGEST }
    })
  })

  test('blocks disabled, blocked, and digest-substituted Host authority before Compiler build', async () => {
    const { installed, store } = await activeProvider()
    const descriptor = onlyDescriptor(store)
    const graph = providerDocumentGraph(descriptor)
    const options = withDefaults({ devMode: false })

    await store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, false)
    expect(
      thrownCode(() =>
        compileAppBackendProviderDocument(store, {
          graph,
          pageIds: [graph.getPages()[0].id],
          options
        })
      )
    ).toBe('provider-unavailable')

    const blocked = changedInstalled(installed, (value) => {
      ;(value.plugin as { blockedReason?: string }).blockedReason = 'blocked by policy'
    })
    expect(
      thrownCode(() =>
        compileAppBackendProviderDocument(hostStore(blocked), {
          graph,
          pageIds: [graph.getPages()[0].id],
          options
        })
      )
    ).toBe('provider-unavailable')

    const substitutedDigest = changedInstalled(installed, (value) => {
      ;(value.plugin.package as { digest: string }).digest = `app-bundle-sha256:${'A'.repeat(43)}`
    })
    expect(
      thrownCode(() =>
        compileAppBackendProviderDocument(hostStore(substitutedDigest), {
          graph,
          pageIds: [graph.getPages()[0].id],
          options
        })
      )
    ).toBe('provider-unavailable')
  })

  test('rejects duplicate explicit document authority before Compiler build', async () => {
    const { store } = await activeProvider()
    const descriptor = onlyDescriptor(store)
    const graph = providerDocumentGraph(descriptor)
    const declaration = graph.getNode(graph.rootId).pluginData?.[0]
    if (!declaration) throw new Error('Expected Backend Provider declaration')
    graph.updateNode(graph.rootId, { pluginData: [declaration, structuredClone(declaration)] })

    expect(
      thrownCode(() =>
        prepareAppBackendProviderCompilerOptions(store, graph, withDefaults({ devMode: false }))
      )
    ).toBe('request-invalid')

    const request = prepareAppBackendProviderCompilerOptions(
      store,
      providerDocumentGraph(descriptor),
      withDefaults({ devMode: false })
    ).backendProvider
    const secondGraph = providerDocumentGraph(descriptor)
    expect(
      thrownCode(() =>
        prepareAppBackendProviderCompilerOptions(
          store,
          secondGraph,
          withDefaults({ devMode: false, backendProvider: request })
        )
      )
    ).toBe('request-invalid')
  })

  test('keeps MCP authority secret-free, bounded to audit and plan, and without Apply', async () => {
    const { store } = await activeProvider()
    const descriptor = onlyDescriptor(store)

    expect(descriptor.mcp).toEqual({
      operations: APP_BACKEND_PROVIDER_MCP_OPERATIONS,
      credentials: 'forbidden',
      sideEffects: 'none'
    })
    expect(isAppBackendProviderMCPOperation('audit')).toBe(true)
    expect(isAppBackendProviderMCPOperation('plan')).toBe(true)
    expect(isAppBackendProviderMCPOperation('apply')).toBe(false)
    expect(isAppBackendProviderMCPOperation('production-deploy')).toBe(false)
    expect(Object.hasOwn(descriptor, 'execute')).toBe(false)
    expect(Object.hasOwn(descriptor, 'credentialResolver')).toBe(false)
    expect(SUPABASE_BACKEND_PROVIDER_CONTRIBUTION.permissions).toEqual([])
    expect(SUPABASE_BACKEND_PROVIDER_CONTRIBUTION.configuration).toEqual({
      schema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
        maxProperties: 0
      },
      maxBytes: 2
    })
  })
})
