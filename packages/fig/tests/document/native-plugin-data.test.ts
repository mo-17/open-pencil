import { expect, test } from 'bun:test'

import { readFixtureArrayBuffer } from '#fig-tests/helpers/fig-fixtures'

import { createFigDocumentSession, parseFigBuffer } from '@open-pencil/fig'
import { guidToString } from '@open-pencil/fig/node-change'

// Native Figma export, 2026-10-05; all 945 authored instances carry token metadata.
// Partial overrides of these instances used to erase 526 entries on 319 instances.
for (const mode of ['full', 'lazy-resumed'] as const) {
  test(`native Gold retains every authored instance plugin entry with ${mode} population`, () => {
    const bytes = readFixtureArrayBuffer('gold-figma-baseline.fig')
    const { nodeChanges } = parseFigBuffer(bytes)
    const expected = nodeChanges.filter(
      (node) => node.type === 'INSTANCE' && node.pluginData?.length
    )
    expect(expected).toHaveLength(945)
    expect(expected.reduce((count, node) => count + (node.pluginData?.length ?? 0), 0)).toBe(2783)

    let session = createFigDocumentSession(bytes, { initiallyPopulateAll: mode === 'full' })
    if (mode === 'lazy-resumed') {
      const first = session.pages[0]
      expect(first).toBeDefined()
      session.loadPage(first.id)
      session = createFigDocumentSession(
        bytes,
        {},
        {
          graph: session.graph,
          checkpoint: session.checkpoint()
        }
      )
      for (const page of session.pages) session.loadPage(page.id)
    }
    const sources = new Map(session.checkpoint().sources)
    const differences: unknown[] = []
    for (const record of expected) {
      if (!record.guid) throw new Error('Native instance is missing its source GUID')
      const source = guidToString(record.guid)
      const id = sources.get(source)
      const node = id ? session.graph.getNode(id) : undefined
      for (const entry of record.pluginData ?? []) {
        const value = node?.pluginData.find(
          (candidate) => candidate.pluginId === entry.pluginID && candidate.key === entry.key
        )?.value
        if (value !== entry.value)
          differences.push({ source, name: record.name, entry, actual: node?.pluginData })
      }
    }
    expect(differences).toEqual([])
    expect(session.loadedPageIds.size).toBe(session.pages.length)
    // Snapshot records are immutable inputs to interpretation and page recovery.
    expect(parseFigBuffer(bytes).nodeChanges).toEqual(nodeChanges)
  }, 30_000)
}
