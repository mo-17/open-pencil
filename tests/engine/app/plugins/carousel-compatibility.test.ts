import { expect, test } from 'bun:test'

import {
  CAROUSEL_STYLE_DEFAULTS,
  CAROUSEL_NAVIGATION_DEFAULTS,
  createCarouselModuleFrameOverrides
} from '@open-pencil/core/plugins'
import { readModuleInstance, SceneGraph } from '@open-pencil/scene-graph'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  resolveAppPluginDocumentDependencies,
  writeAppPluginDocumentLock
} from '@/app/plugins'

test.each([1, 2])(
  'current bundled carousel accepts strict v%i instances without rewriting their version',
  async (version) => {
    const graph = new SceneGraph()
    const node = graph.createNode(
      'FRAME',
      graph.getPages()[0].id,
      createCarouselModuleFrameOverrides()
    )
    const current = readModuleInstance(node.interactiveProps?.module)
    if (!current) throw new Error('Expected carousel')
    const config = structuredClone(current.config)
    const keys =
      version === 1
        ? { ...CAROUSEL_STYLE_DEFAULTS, ...CAROUSEL_NAVIGATION_DEFAULTS }
        : CAROUSEL_NAVIGATION_DEFAULTS
    for (const key of Object.keys(keys)) Reflect.deleteProperty(config, key)
    const legacy = { ...current, configVersion: version, config }
    graph.updateNode(node.id, { interactiveProps: { module: legacy } })
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: createBundledPluginCatalog(),
      activationCompatibilityPolicy: () => ({ ok: true }),
      engineVersion: '0.13.2'
    })
    await store.load()
    await store.install('open-pencil.carousel')
    await store.setEnabled('open-pencil.carousel', true)
    const installed = store.snapshot().installed
    expect(resolveAppPluginDocumentDependencies(graph, installed)).toMatchObject({
      dependencies: [
        {
          pluginId: 'open-pencil.carousel',
          status: 'lock-missing',
          modules: [{ moduleType: 'carousel', configVersions: [version] }],
          invalidModuleConfigs: []
        }
      ]
    })
    writeAppPluginDocumentLock(graph, installed)
    expect(resolveAppPluginDocumentDependencies(graph, installed)).toMatchObject({
      ok: true,
      dependencies: [{ status: 'ready', modules: [{ configVersions: [version] }] }]
    })
    expect(readModuleInstance(node.interactiveProps?.module)).toEqual(legacy)
  }
)
