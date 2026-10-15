import { expect, test } from 'bun:test'

import { readFixtureArrayBuffer } from '#core-tests/helpers/fig/fixtures'

import { parseFigBuffer } from '@open-pencil/fig'
import { guidToString } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

import { exportFigFileWithOptions, parseFigFile } from '#core/io'
import { populateAllFigPages } from '#core/io/formats/fig'

function sourceId(record: NodeChange): string {
  if (!record.guid) throw new Error('Native record is missing its source GUID')
  return guidToString(record.guid)
}

for (const populate of ['all', 'first-page'] as const) {
  for (const profile of ['roundtrip', 'figma-compatible'] as const) {
    test(`native Gold plugin metadata survives an edited ${profile} export from ${populate}`, async () => {
      const input = readFixtureArrayBuffer('gold-figma-baseline.fig')
      const { nodeChanges } = parseFigBuffer(input)
      const expected = nodeChanges.filter(
        (node) => node.type === 'INSTANCE' && node.pluginData?.length
      )
      expect(expected).toHaveLength(945)
      const graph = await parseFigFile(input, { populate })
      const page = graph.getPages()[0]
      expect(page).toBeDefined()
      // A real edit prevents the unchanged-archive passthrough from hiding serializer loss.
      const originalName = page.name
      graph.updateNode(page.id, { name: `${originalName} metadata regression` })
      const nodeCount = graph.nodes.size
      const bytes = await exportFigFileWithOptions(graph, { profile })
      expect(bytes.byteLength).toBeGreaterThan(0)
      expect(graph.nodes.size).toBe(nodeCount)
      const saved = parseFigBuffer(bytes.slice().buffer)
      const records = new Map(saved.nodeChanges.map((node) => [sourceId(node), node]))
      const differences: unknown[] = []
      for (const record of expected) {
        const source = sourceId(record)
        const actual = records.get(source)
        for (const entry of record.pluginData ?? []) {
          const value = actual?.pluginData?.find(
            (candidate) => candidate.pluginID === entry.pluginID && candidate.key === entry.key
          )?.value
          if (value !== entry.value) differences.push({ source, entry, value })
        }
      }
      expect(differences).toEqual([])
      const reopened = await parseFigFile(bytes.slice().buffer, { populate: 'all' })
      expect(reopened.getPages()[0]?.name).toBe(`${originalName} metadata regression`)
      populateAllFigPages(graph)
      const captureAuthored = (sourceGraph: typeof graph) => {
        const nodes = new Map(
          [...sourceGraph.getAllNodes()].map((node) => [node.source.id, node] as const)
        )
        return expected.map((record) => {
          const source = sourceId(record)
          const node = nodes.get(source)
          return {
            source,
            entries: (record.pluginData ?? []).map((entry) => ({
              pluginId: entry.pluginID,
              key: entry.key,
              value: node?.pluginData.find(
                (candidate) => candidate.pluginId === entry.pluginID && candidate.key === entry.key
              )?.value
            }))
          }
        })
      }
      // Generated OpenPencil metadata can be added; every native entry must remain exact.
      expect(captureAuthored(reopened)).toEqual(captureAuthored(graph))
    }, 120_000)
  }
}
