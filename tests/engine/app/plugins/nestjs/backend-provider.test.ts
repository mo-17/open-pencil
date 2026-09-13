import { describe, expect, test } from 'bun:test'

import { unzipSync } from 'fflate'

import { compile, type CompilerInput } from '@open-pencil/compiler'
import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from '@open-pencil/compiler/backend'
import { digestCanonicalManifest, SceneGraph } from '@open-pencil/scene-graph'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  appBackendProviderDocumentValue,
  inspectInstalledBackendProviderCompatibility,
  listAppBackendProviderDescriptors,
  resolveAppBackendProviderDescriptor,
  type AppBackendProviderHostStore
} from '@/app/plugins/host/backend-provider'
import {
  NESTJS_BACKEND_PROVIDER_CONTRIBUTION,
  NESTJS_BACKEND_PROVIDER_PACKAGE_DIGEST,
  NESTJS_BACKEND_PROVIDER_PLUGIN_ID
} from '@/app/plugins/host/nestjs/backend-provider'
import { exportCurrentDocumentAsNextJsSource } from '@/app/plugins/host/nextjs-exporter'
import { archiveProjectFiles } from '@/app/plugins/host/project-archive'
import {
  exportCurrentDocumentAsVueSource,
  type VueSourceExporterDependencies
} from '@/app/plugins/host/vue/source-exporter'

import { nestJSApplication } from '#tests/engine/compiler/backend/nestjs/helpers'

async function fixture() {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === NESTJS_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (!entry) throw new Error('Expected bundled NestJS provider')
  const store = createAppPluginStore({
    catalog: [entry],
    storage: createMemoryAppPluginStateStorage(),
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  expect((await store.load()).error).toBeNull()
  const [descriptor] = listAppBackendProviderDescriptors(store)
  const installed = store.backendProvider(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, 'nestjs')
  if (!descriptor || !installed) throw new Error('Expected reviewed installed NestJS provider')
  const graph = new SceneGraph()
  graph.createNode('FRAME', graph.getPages()[0].id, { name: 'NestJS client' })
  graph.updateNode(graph.rootId, {
    pluginData: [
      {
        pluginId: 'open-pencil',
        key: 'lowcode/backendProvider.v1',
        value: appBackendProviderDocumentValue({
          format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
          selection: descriptor,
          application: nestJSApplication()
        })
      }
    ]
  })
  return {
    entry,
    store,
    descriptor,
    installed,
    source: { graph, state: { documentName: 'NestJS client' } }
  }
}

function exportDependencies(store: AppBackendProviderHostStore) {
  const captured: { bytes?: Uint8Array; input?: CompilerInput; compiles: number; writes: number } =
    {
      compiles: 0,
      writes: 0
    }
  const dependencies: VueSourceExporterDependencies = {
    resolveBackendProviderStore: () => store,
    async chooseDestination() {
      return {
        async write(bytes) {
          captured.bytes = bytes
          captured.writes += 1
        }
      }
    },
    async resolveFontManifest() {
      return { faces: [] }
    },
    compile(input) {
      captured.input = input
      captured.compiles += 1
      return compile(input)
    },
    archive: archiveProjectFiles
  }
  return { captured, dependencies }
}

describe('NestJS App source generation authority', () => {
  test('pins the actual inert catalog package and preserves the installed lifecycle', async () => {
    const { entry, store, descriptor } = await fixture()
    expect(entry).toMatchObject({ installedByDefault: true, enabledByDefault: true })
    expect(entry.manifest).toMatchObject({
      capabilities: [],
      contributions: { backendProviders: [NESTJS_BACKEND_PROVIDER_CONTRIBUTION] }
    })
    expect('commands' in entry.manifest.contributions).toBe(false)
    expect(NESTJS_BACKEND_PROVIDER_CONTRIBUTION.permissions).toEqual([])
    expect(NESTJS_BACKEND_PROVIDER_PACKAGE_DIGEST).toBe(
      `app-bundle-sha256:${await digestCanonicalManifest(entry.manifest)}`
    )
    expect(descriptor.packageAuthority.packageDigest).toBe(NESTJS_BACKEND_PROVIDER_PACKAGE_DIGEST)
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
    }).toEqual(NESTJS_BACKEND_PROVIDER_DESCRIPTOR)
    await store.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, false)
    expect(resolveAppBackendProviderDescriptor(store, descriptor)).toBeNull()
    await store.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, true)
    expect(resolveAppBackendProviderDescriptor(store, descriptor)).not.toBeNull()
    await store.uninstall(NESTJS_BACKEND_PROVIDER_PLUGIN_ID)
    expect(resolveAppBackendProviderDescriptor(store, descriptor)).toBeNull()
  })

  test.each(['react', 'vue'] as const)(
    'exports actual %s compiler output with NestJS sources through ZIP',
    async (target) => {
      const { store, source } = await fixture()
      const { dependencies, captured } = exportDependencies(store)
      const run =
        target === 'react' ? exportCurrentDocumentAsNextJsSource : exportCurrentDocumentAsVueSource
      const result = await run(source, dependencies)
      expect(result.saved).toBe(true)
      expect(captured.compiles).toBe(1)
      expect(captured.writes).toBe(1)
      expect(captured.input?.options).toMatchObject({
        target,
        devMode: false,
        backendProvider: { selection: { descriptor: { providerId: 'nestjs' }, enabled: true } }
      })
      if (!captured.bytes) throw new Error('Expected real NestJS source archive')
      const files = unzipSync(captured.bytes)
      expect(files['backend/nestjs/package.json']).toBeDefined()
      expect(files['backend/nestjs/src/main.ts']).toBeDefined()
      expect(
        JSON.parse(new TextDecoder().decode(files['openpencil-backend.manifest.json']))
      ).toMatchObject({
        authority: { providerId: 'nestjs', packageDigest: NESTJS_BACKEND_PROVIDER_PACKAGE_DIGEST },
        target,
        mode: 'production'
      })
      expect(Object.keys(files).some((path) => path.includes('supabase'))).toBe(false)
    }
  )

  test('rejects disabled, digest-substituted and declaration-substituted providers before compile or write', async () => {
    const { store, installed, source } = await fixture()
    const changedDigest = structuredClone(installed)
    Reflect.set(changedDigest.plugin.package, 'digest', `app-bundle-sha256:${'A'.repeat(43)}`)
    const changedDeclaration = structuredClone(installed)
    Reflect.set(changedDeclaration.contribution, 'permissions', ['network'])
    for (const changed of [changedDigest, changedDeclaration]) {
      expect(inspectInstalledBackendProviderCompatibility(changed).ok).toBe(false)
    }
    await store.setEnabled(NESTJS_BACKEND_PROVIDER_PLUGIN_ID, false)
    const sources: AppBackendProviderHostStore[] = [
      store,
      { installedBackendProviders: () => [changedDigest] },
      { installedBackendProviders: () => [changedDeclaration] }
    ]
    for (const current of sources) {
      const { dependencies, captured } = exportDependencies(current)
      await expect(exportCurrentDocumentAsVueSource(source, dependencies)).rejects.toMatchObject({
        code: 'provider-unavailable'
      })
      expect(captured.compiles).toBe(0)
      expect(captured.writes).toBe(0)
    }
  })
})
