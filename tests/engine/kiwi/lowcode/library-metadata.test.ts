import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import {
  exportFigFile,
  initCodec,
  parseFigFile,
  SceneGraph,
  type LibraryRef,
  type PluginDataEntry,
  type SceneNode
} from '@open-pencil/core'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { PluginData } from '@open-pencil/kiwi/fig/codec'
import {
  ensureLibraryCachePage,
  importLibraryComponent,
  type LibraryManifest
} from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  LOWCODE_LIBRARIES_KEY,
  LOWCODE_LIBRARY_CACHE_KEY,
  LOWCODE_LIBRARY_COMPONENT_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

setDefaultTimeout(30_000)

function makeNode(fields: Partial<SceneNode> = {}): SceneNode {
  return {
    type: 'COMPONENT',
    pluginData: [] as PluginDataEntry[],
    ...fields
  } as SceneNode
}

function makePluginData(entries: Array<{ key: string; value: unknown }>): PluginData[] {
  return entries.map((entry) => ({
    pluginID: OPEN_PENCIL_PLUGIN_ID,
    key: entry.key,
    value: JSON.stringify(entry.value)
  }))
}

const libraryRefs: LibraryRef[] = [
  {
    libraryId: 'design-system',
    name: 'Design System',
    source: { kind: 'file', ref: '../libraries/design-system.fig' },
    manifestSource: { kind: 'url', ref: 'https://example.com/design-system.json' },
    importedComponents: [{ key: 'component-card', version: 'v1' }]
  }
]

describe('lowcode team-library pluginData (Phase 4 §14)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('serializes cached component master metadata and root library refs', () => {
    const entries = serializeLowcodeFields(
      makeNode({
        libraryComponentKey: 'component-card',
        libraryId: 'design-system',
        libraryVersion: 'v1',
        libraryReadonly: true,
        lowcodeLibraries: libraryRefs,
        lowcodeLibraryCache: true
      })
    )

    expect(entries.map((entry) => entry.key)).toEqual([
      LOWCODE_LIBRARY_COMPONENT_KEY,
      LOWCODE_LIBRARIES_KEY,
      LOWCODE_LIBRARY_CACHE_KEY
    ])
    expect(JSON.parse(entries[0].value)).toEqual({
      key: 'component-card',
      libraryId: 'design-system',
      version: 'v1',
      readonly: true
    })
    expect(JSON.parse(entries[1].value)).toEqual(libraryRefs)
    expect(JSON.parse(entries[2].value)).toBe(true)
  })

  test('extracts library pluginData into structured fields and strips owned entries', () => {
    const result = extractLowcodeAndPluginData({
      pluginData: [
        ...makePluginData([
          {
            key: LOWCODE_LIBRARY_COMPONENT_KEY,
            value: {
              key: 'component-card',
              libraryId: 'design-system',
              version: 'v2',
              readonly: true
            }
          },
          { key: LOWCODE_LIBRARIES_KEY, value: libraryRefs },
          { key: LOWCODE_LIBRARY_CACHE_KEY, value: true }
        ]),
        { pluginID: 'other-plugin', key: 'lowcode/libraryComponent', value: '{}' }
      ]
    })

    expect(result.libraryComponentKey).toBe('component-card')
    expect(result.libraryId).toBe('design-system')
    expect(result.libraryVersion).toBe('v2')
    expect(result.libraryReadonly).toBe(true)
    expect(result.lowcodeLibraries).toEqual(libraryRefs)
    expect(result.lowcodeLibraryCache).toBe(true)
    expect(result.pluginData).toEqual([
      { pluginId: 'other-plugin', key: 'lowcode/libraryComponent', value: '{}' }
    ])
  })

  test('accepts legacy refs without manifestSource and rejects malformed manifestSource', () => {
    const legacyRefs: LibraryRef[] = [
      {
        libraryId: 'legacy',
        name: 'Legacy Library',
        source: { kind: 'file', ref: './legacy.fig' },
        importedComponents: []
      }
    ]
    const legacy = extractLowcodeAndPluginData({
      pluginData: makePluginData([{ key: LOWCODE_LIBRARIES_KEY, value: legacyRefs }])
    })
    expect(legacy.lowcodeLibraries).toEqual(legacyRefs)

    const malformed = extractLowcodeAndPluginData({
      pluginData: makePluginData([
        {
          key: LOWCODE_LIBRARIES_KEY,
          value: [{ ...legacyRefs[0], manifestSource: { kind: 'http', ref: 42 } }]
        }
      ])
    })
    expect(malformed.lowcodeLibraries).toBeUndefined()
  })

  test('round-trips library metadata through real .fig export and parse', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const master = graph.createNode('COMPONENT', page.id, {
      name: 'Shared Card',
      componentKey: 'component-card',
      libraryComponentKey: 'component-card',
      libraryId: 'design-system',
      libraryVersion: 'v1',
      libraryReadonly: true
    })
    const cachePage = graph.addPage('OpenPencil Library Cache')
    graph.updateNode(cachePage.id, { internalOnly: true, lowcodeLibraryCache: true })
    graph.updateNode(graph.rootId, { lowcodeLibraries: libraryRefs })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedMaster = [...reimported.getAllNodes()].find((node) => node.name === master.name)
    const root = reimported.getNode(reimported.rootId)
    const reimportedCachePage = [...reimported.getAllNodes()].find(
      (node) => node.name === cachePage.name
    )

    expect(reimportedMaster?.type).toBe('COMPONENT')
    expect(reimportedMaster?.componentKey).toBe('component-card')
    expect(reimportedMaster?.libraryComponentKey).toBe('component-card')
    expect(reimportedMaster?.libraryId).toBe('design-system')
    expect(reimportedMaster?.libraryVersion).toBe('v1')
    expect(reimportedMaster?.libraryReadonly).toBe(true)
    expect(root?.lowcodeLibraries).toEqual(libraryRefs)
    expect(reimportedCachePage?.type).toBe('CANVAS')
    expect(reimportedCachePage?.lowcodeLibraryCache).toBe(true)
    expect(reimportedCachePage?.internalOnly).toBe(true)
    expect(
      reimportedMaster?.pluginData.some((entry) => entry.key === LOWCODE_LIBRARY_COMPONENT_KEY)
    ).toBe(false)
  })

  test('reopens a remote cache master and instantiates it offline', async () => {
    const artifactSource = {
      kind: 'url',
      ref: 'https://cdn.example.com/design-system-v1.fig'
    } as const
    const manifestSource = {
      kind: 'url',
      ref: 'https://cdn.example.com/design-system.json'
    } as const
    const sourceGraph = new SceneGraph()
    const sourcePage = sourceGraph.getPages()[0]
    const sourceMaster = sourceGraph.createNode('COMPONENT', sourcePage.id, {
      name: 'Remote Card',
      componentKey: 'remote-card',
      width: 240,
      height: 80
    })
    sourceGraph.createNode('RECTANGLE', sourceMaster.id, {
      name: 'Remote Card Surface',
      width: 200,
      height: 48
    })
    const manifest: LibraryManifest = {
      libraryId: 'remote-design-system',
      name: 'Remote Design System',
      source: artifactSource,
      components: [
        {
          key: 'remote-card',
          name: sourceMaster.name,
          version: 'v1',
          nodeId: sourceMaster.id,
          type: 'COMPONENT'
        }
      ]
    }

    const graph = new SceneGraph()
    const cachePage = ensureLibraryCachePage(graph)
    const imported = importLibraryComponent({
      sourceGraph,
      targetGraph: graph,
      manifest,
      componentKey: 'remote-card',
      parentId: cachePage.id,
      source: artifactSource,
      manifestSource
    })
    if ('error' in imported) throw new Error(imported.error)
    expect(graph.getNode(imported.importedNodeId)?.parentId).toBe(cachePage.id)

    const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const reopenedRoot = reopened.getNode(reopened.rootId)
    const reopenedCachePage = reopened
      .getPages(true)
      .find((page) => page.lowcodeLibraryCache === true)
    const reopenedMaster = [...reopened.getAllNodes()].find(
      (node) =>
        node.type === 'COMPONENT' &&
        node.libraryId === manifest.libraryId &&
        node.libraryComponentKey === 'remote-card'
    )

    expect(reopenedCachePage).toMatchObject({
      type: 'CANVAS',
      internalOnly: true,
      lowcodeLibraryCache: true
    })
    expect(reopenedMaster?.parentId).toBe(reopenedCachePage?.id)
    expect(reopenedRoot?.lowcodeLibraries).toEqual([
      {
        libraryId: manifest.libraryId,
        name: manifest.name,
        source: artifactSource,
        manifestSource,
        importedComponents: [{ key: 'remote-card', version: 'v1' }]
      }
    ])

    if (!reopenedMaster) throw new Error('Expected the cached remote master after reopen')
    const visiblePage = reopened.getPages()[0]
    const instance = reopened.createInstance(reopenedMaster.id, visiblePage.id)
    if (!instance) throw new Error('Expected the cached remote master to create an instance')
    const masterChild = reopened.getNode(reopenedMaster.childIds[0] ?? '')
    const instanceChild = reopened.getNode(instance.childIds[0] ?? '')
    if (!masterChild || !instanceChild) throw new Error('Expected master and instance children')

    reopened.updateNode(masterChild.id, { width: 320 })
    reopened.syncInstances(reopenedMaster.id)

    expect(instance.componentId).toBe(reopenedMaster.id)
    expect(reopened.getNode(instanceChild.id)?.width).toBe(320)
  })
})
