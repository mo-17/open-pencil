import { describe, expect, test } from 'bun:test'

import { createMapModuleFrameOverrides } from '@open-pencil/core/plugins'
import {
  PLUGIN_DOCUMENT_LOCK_LIMITS,
  readModuleInstance,
  SceneGraph
} from '@open-pencil/scene-graph'

import {
  APP_PLUGIN_DOCUMENT_DATA_ID,
  APP_PLUGIN_DOCUMENT_LOCK_KEY,
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  readAppPluginDocumentLock,
  resolveAppPluginDocumentDependencies,
  writeAppPluginDocumentLock
} from '@/app/plugins'

const ENGINE_VERSION = '0.13.2'

async function fixture(catalog = createBundledPluginCatalog()) {
  const graph = new SceneGraph()
  graph.createNode('FRAME', graph.getPages()[0].id, createMapModuleFrameOverrides())
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog,
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: ENGINE_VERSION
  })
  await store.load()
  return { graph, store }
}

function changeReferencedModule(
  graph: SceneGraph,
  changes: Partial<{ moduleType: string; configVersion: number }>
): void {
  const node = graph.getAllNodes().find((candidate) => candidate.interactiveProps?.module)
  if (!node) throw new Error('Expected module node')
  const module = readModuleInstance(node.interactiveProps?.module)
  if (!module) throw new Error('Expected valid module instance')
  graph.updateNode(node.id, {
    interactiveProps: {
      ...node.interactiveProps,
      module: { ...module, ...changes }
    }
  })
}

describe('app plugin document lock', () => {
  test('writes a portable root pluginData lock for modules referenced by the document', async () => {
    const { graph, store } = await fixture()

    const lock = writeAppPluginDocumentLock(graph, store.snapshot().installed)

    expect(lock.plugins).toEqual([
      expect.objectContaining({
        pluginId: 'open-pencil.map',
        version: '1.0.0',
        publisherKeyId: 'app-bundle-v1'
      })
    ])
    expect(lock.plugins[0].manifestDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(readAppPluginDocumentLock(graph)).toEqual({ status: 'valid', lock, error: null })
    expect(
      graph
        .getNode(graph.rootId)
        ?.pluginData.some(
          (entry) =>
            entry.pluginId === APP_PLUGIN_DOCUMENT_DATA_ID &&
            entry.key === APP_PLUGIN_DOCUMENT_LOCK_KEY
        )
    ).toBe(true)
    expect(resolveAppPluginDocumentDependencies(graph, store.snapshot().installed).ok).toBe(true)
  })

  test('reports missing, disabled, mismatched, and malformed dependencies without blocking reads', async () => {
    const { graph, store } = await fixture()
    expect(resolveAppPluginDocumentDependencies(graph, []).dependencies[0]?.status).toBe(
      'not-installed'
    )
    expect(resolveAppPluginDocumentDependencies(graph, store.snapshot().installed)).toMatchObject({
      ok: false,
      lock: { status: 'absent' },
      dependencies: [{ status: 'lock-missing' }]
    })

    writeAppPluginDocumentLock(graph, store.snapshot().installed)
    await store.setEnabled('open-pencil.map', false)
    expect(
      resolveAppPluginDocumentDependencies(graph, store.snapshot().installed).dependencies[0]
        ?.status
    ).toBe('disabled')

    const root = graph.getNode(graph.rootId)
    if (!root) throw new Error('Expected root')
    const record = root.pluginData.find(
      (entry) =>
        entry.pluginId === APP_PLUGIN_DOCUMENT_DATA_ID && entry.key === APP_PLUGIN_DOCUMENT_LOCK_KEY
    )
    if (!record) throw new Error('Expected lock record')
    const changed = JSON.parse(record.value)
    changed.plugins[0].version = '9.0.0'
    graph.updateNode(root.id, {
      pluginData: root.pluginData.map((entry) =>
        entry === record ? { ...entry, value: JSON.stringify(changed) } : entry
      )
    })
    await store.setEnabled('open-pencil.map', true)
    expect(
      resolveAppPluginDocumentDependencies(graph, store.snapshot().installed).dependencies[0]
        ?.status
    ).toBe('version-mismatch')

    graph.updateNode(root.id, {
      pluginData: root.pluginData.map((entry) =>
        entry.pluginId === APP_PLUGIN_DOCUMENT_DATA_ID && entry.key === APP_PLUGIN_DOCUMENT_LOCK_KEY
          ? { ...entry, value: '{broken' }
          : entry
      )
    })
    expect(resolveAppPluginDocumentDependencies(graph, store.snapshot().installed)).toMatchObject({
      ok: false,
      lock: { status: 'invalid' }
    })
  })

  test('fails closed when a referenced module is absent from the accepted manifest', async () => {
    const { graph, store } = await fixture()
    changeReferencedModule(graph, { moduleType: 'unknown-module' })

    expect(resolveAppPluginDocumentDependencies(graph, store.snapshot().installed)).toMatchObject({
      ok: false,
      dependencies: [
        {
          status: 'unsupported-module',
          modules: [{ moduleType: 'unknown-module', configVersions: [1] }]
        }
      ]
    })
    expect(() => writeAppPluginDocumentLock(graph, store.snapshot().installed)).toThrow(
      'not declared'
    )
  })

  test('fails closed when a referenced module config version differs from the manifest', async () => {
    const { graph, store } = await fixture()
    changeReferencedModule(graph, { configVersion: 2 })

    expect(resolveAppPluginDocumentDependencies(graph, store.snapshot().installed)).toMatchObject({
      ok: false,
      dependencies: [
        {
          status: 'config-version-mismatch',
          modules: [{ moduleType: 'map', configVersions: [2] }]
        }
      ]
    })
    expect(() => writeAppPluginDocumentLock(graph, store.snapshot().installed)).toThrow(
      'config version is incompatible'
    )
  })

  test('fails closed when the accepted manifest has no reviewed host adapter', async () => {
    const catalog = createBundledPluginCatalog().map((entry) =>
      entry.manifest.plugin.id === 'open-pencil.map'
        ? {
            ...entry,
            manifest: {
              ...entry.manifest,
              contributions: {
                modules: entry.manifest.contributions.modules.map((contribution) => ({
                  ...contribution,
                  adapterId: 'publisher.unknown'
                }))
              }
            }
          }
        : entry
    )
    const { graph, store } = await fixture(catalog)

    expect(resolveAppPluginDocumentDependencies(graph, store.snapshot().installed)).toMatchObject({
      ok: false,
      dependencies: [{ status: 'unsupported-host-adapter' }]
    })
    expect(() => writeAppPluginDocumentLock(graph, store.snapshot().installed)).toThrow(
      'no compatible host adapter'
    )
  })

  test('reports an invalid module envelope instead of silently omitting it from the lock', async () => {
    const { graph, store } = await fixture()
    const node = graph.getAllNodes().find((candidate) => candidate.interactiveProps?.module)
    if (!node) throw new Error('Expected module node')
    graph.updateNode(node.id, {
      interactiveProps: {
        ...node.interactiveProps,
        module: { version: 1, pluginId: 'open-pencil.map' }
      }
    })

    expect(resolveAppPluginDocumentDependencies(graph, store.snapshot().installed)).toMatchObject({
      ok: false,
      dependencies: [],
      invalidModuleCount: 1,
      invalidModules: [{ nodeId: node.id }]
    })
    expect(() => writeAppPluginDocumentLock(graph, store.snapshot().installed)).toThrow(
      `invalid at ${node.id}`
    )
  })

  test('validates every module instance config with the reviewed host definition', async () => {
    const { graph, store } = await fixture()
    const node = graph.getAllNodes().find((candidate) => candidate.interactiveProps?.module)
    if (!node) throw new Error('Expected module node')
    const module = readModuleInstance(node.interactiveProps?.module)
    if (!module) throw new Error('Expected valid module instance')
    graph.updateNode(node.id, {
      interactiveProps: {
        ...node.interactiveProps,
        module: { ...module, config: { ...module.config, zoom: 99 } }
      }
    })

    expect(resolveAppPluginDocumentDependencies(graph, store.snapshot().installed)).toMatchObject({
      ok: false,
      invalidModuleCount: 0,
      dependencies: [
        {
          status: 'invalid-module-config',
          invalidModuleConfigs: [{ nodeId: node.id, moduleType: 'map' }]
        }
      ]
    })
    expect(() => writeAppPluginDocumentLock(graph, store.snapshot().installed)).toThrow(
      `config is invalid at ${node.id}`
    )
  })

  test('rejects an oversized document lock before parsing JSON', () => {
    const graph = new SceneGraph()
    const root = graph.getNode(graph.rootId)
    if (!root) throw new Error('Expected root')
    graph.updateNode(root.id, {
      pluginData: [
        {
          pluginId: APP_PLUGIN_DOCUMENT_DATA_ID,
          key: APP_PLUGIN_DOCUMENT_LOCK_KEY,
          value: ' '.repeat(PLUGIN_DOCUMENT_LOCK_LIMITS.maxJsonBytes + 1)
        }
      ]
    })

    const result = readAppPluginDocumentLock(graph)
    expect(result.status).toBe('invalid')
    expect(result.error?.message).toContain('UTF-8 bytes')
  })
})
