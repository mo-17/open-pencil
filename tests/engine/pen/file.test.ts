import { describe, expect, test } from 'bun:test'

import { parsePenFile } from '@open-pencil/core'

import { repoPath } from '#tests/helpers/paths'

const FIXTURE_DIR = repoPath('tests/fixtures')

async function loadFixture(name: string): Promise<string> {
  return Bun.file(`${FIXTURE_DIR}/${name}`).text()
}

describe('parsePenFile', () => {
  test('imports variables and theme modes', async () => {
    const graph = parsePenFile(await loadFixture('pencil_simple.pen'))
    const collections = [...graph.variableCollections.values()]

    expect(collections.length).toBe(1)
    expect(collections[0].modes.map((mode) => mode.name)).toEqual(['Light', 'Dark'])
    expect(graph.variables.size).toBeGreaterThan(0)
  })

  test('maps reusable frames to components', async () => {
    const graph = parsePenFile(await loadFixture('pencil_button.pen'))
    const components = [...graph.getAllNodes()].filter((node) => node.type === 'COMPONENT')

    expect(components.length).toBeGreaterThan(0)
    expect(components[0]?.name).toContain('Button')
  })

  test('maps path geometry to vector nodes', async () => {
    const graph = parsePenFile(await loadFixture('pencil_button.pen'))
    const vectors = [...graph.getAllNodes()].filter((node) => node.type === 'VECTOR')

    expect(vectors.length).toBeGreaterThan(0)
    expect(vectors.some((node) => (node.vectorNetwork?.vertices.length ?? 0) > 0)).toBe(true)
  })

  test('imports document and page SEO metadata', () => {
    const graph = parsePenFile(
      JSON.stringify({
        version: '1',
        lowcodeSeoMetadata: {
          title: 'Root SEO',
          description: 'Root description.'
        },
        pageSeoMetadata: {
          title: 'Page SEO',
          canonicalUrl: 'https://example.com/page'
        },
        children: [{ id: 'hero', type: 'frame', name: 'Landing', children: [] }]
      })
    )

    expect(graph.getNode(graph.rootId)?.lowcodeSeoMetadata).toEqual({
      title: 'Root SEO',
      description: 'Root description.'
    })
    expect(graph.getPages()[0].lowcodeSeoMetadata).toEqual({
      title: 'Page SEO',
      canonicalUrl: 'https://example.com/page'
    })
  })
})
