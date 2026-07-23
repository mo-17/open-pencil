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
  extractLowcodeAndPluginData,
  LOWCODE_LIBRARIES_KEY,
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
        lowcodeLibraries: libraryRefs
      })
    )

    expect(entries.map((entry) => entry.key)).toEqual([
      LOWCODE_LIBRARY_COMPONENT_KEY,
      LOWCODE_LIBRARIES_KEY
    ])
    expect(JSON.parse(entries[0].value)).toEqual({
      key: 'component-card',
      libraryId: 'design-system',
      version: 'v1',
      readonly: true
    })
    expect(JSON.parse(entries[1].value)).toEqual(libraryRefs)
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
          { key: LOWCODE_LIBRARIES_KEY, value: libraryRefs }
        ]),
        { pluginID: 'other-plugin', key: 'lowcode/libraryComponent', value: '{}' }
      ]
    })

    expect(result.libraryComponentKey).toBe('component-card')
    expect(result.libraryId).toBe('design-system')
    expect(result.libraryVersion).toBe('v2')
    expect(result.libraryReadonly).toBe(true)
    expect(result.lowcodeLibraries).toEqual(libraryRefs)
    expect(result.pluginData).toEqual([
      { pluginId: 'other-plugin', key: 'lowcode/libraryComponent', value: '{}' }
    ])
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
    graph.updateNode(graph.rootId, { lowcodeLibraries: libraryRefs })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedMaster = [...reimported.getAllNodes()].find((node) => node.name === master.name)
    const root = reimported.getNode(reimported.rootId)

    expect(reimportedMaster?.type).toBe('COMPONENT')
    expect(reimportedMaster?.componentKey).toBe('component-card')
    expect(reimportedMaster?.libraryComponentKey).toBe('component-card')
    expect(reimportedMaster?.libraryId).toBe('design-system')
    expect(reimportedMaster?.libraryVersion).toBe('v1')
    expect(reimportedMaster?.libraryReadonly).toBe(true)
    expect(root?.lowcodeLibraries).toEqual(libraryRefs)
    expect(
      reimportedMaster?.pluginData.some((entry) => entry.key === LOWCODE_LIBRARY_COMPONENT_KEY)
    ).toBe(false)
  })
})
