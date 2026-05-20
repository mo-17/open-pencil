import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { exportFigFile, initCodec, SceneGraph } from '@open-pencil/core'
import { importNodeChanges } from '#core/kiwi/fig/import'
import { parseFigBuffer } from '#core/kiwi/fig/parse/core'
import {
  deserializeSceneGraph,
  serializeSceneGraph
} from '#core/kiwi/fig/parse/transfer'

setDefaultTimeout(30_000)

/**
 * The async `parseFigFile` path runs the parser in a Web Worker and ships
 * the SceneGraph back via `postMessage`, which goes through
 * `serializeSceneGraph` (Map → Array) → structured clone → `deserializeSceneGraph`
 * (Array → Map). The synchronous tests in `roundtrip.test.ts` skip that
 * boundary entirely, so a bug that only manifests inside the transfer step
 * would never trip them.
 *
 * The user-reported regression is that, when reopening a `.fig` saved from
 * Tauri with multiple named pages, the second page's children appear under
 * the first page. The hypothesis is that the worker boundary is at fault.
 * These tests model the boundary byte-for-byte without needing a real
 * Worker, by composing the same call chain `worker.ts` uses on each side.
 */
describe('worker-path multi-page round-trip (Tauri reopen reproducer)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  /**
   * Replays exactly what `worker.ts` does (`parseFigBuffer` →
   * `importNodeChanges` → `serializeSceneGraph`) and exactly what
   * `parseFigFile`'s main-thread continuation does
   * (`deserializeSceneGraph(structuredClone(...))`). `structuredClone` is
   * the same algorithm `postMessage` runs across the worker boundary.
   */
  async function parseViaSimulatedWorker(graph: SceneGraph): Promise<SceneGraph> {
    const bytes = await exportFigFile(graph)
    const { nodeChanges, blobs, images, figKiwiVersion } = parseFigBuffer(bytes.buffer)
    const built = importNodeChanges(nodeChanges, blobs, new Map(images), {
      populate: 'first-page'
    })
    built.figKiwiVersion = figKiwiVersion
    const serialized = serializeSceneGraph(built)
    const cloned = structuredClone(serialized)
    return deserializeSceneGraph(cloned)
  }

  test('two named pages with distinct children stay isolated across worker boundary', async () => {
    const graph = new SceneGraph()
    const homePage = graph.getPages()[0]
    graph.updateNode(homePage.id, { name: 'Home' })
    const homeRect = graph.createNode('RECTANGLE', homePage.id, {
      name: 'home-rect',
      width: 80,
      height: 40
    })
    const homeText = graph.createNode('TEXT', homePage.id, {
      name: 'home-text',
      text: 'home'
    })

    const aboutPage = graph.addPage('About')
    const aboutRect = graph.createNode('RECTANGLE', aboutPage.id, {
      name: 'about-rect',
      width: 100,
      height: 60
    })
    const aboutText = graph.createNode('TEXT', aboutPage.id, {
      name: 'about-text',
      text: 'about'
    })

    const reimported = await parseViaSimulatedWorker(graph)
    const pages = reimported.getPages()
    expect(pages.map((p) => p.name)).toEqual(['Home', 'About'])

    const homeChildren = reimported.getChildren(pages[0].id).map((n) => n.name).sort()
    const aboutChildren = reimported.getChildren(pages[1].id).map((n) => n.name).sort()
    expect(homeChildren).toEqual(['home-rect', 'home-text'])
    expect(aboutChildren).toEqual(['about-rect', 'about-text'])

    // Sanity: nothing about the original ids matters (they're regenerated),
    // we're only proving the worker boundary doesn't reparent children.
    void homeRect
    void homeText
    void aboutRect
    void aboutText
  })

  test('three pages with lowcode state on each stay isolated across worker boundary', async () => {
    const graph = new SceneGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, {
      name: 'Home',
      state: [{ id: 's-home', name: 'count', type: 'number', defaultValue: 0 }]
    })
    graph.createNode('BUTTON', home.id, { name: 'home-btn', width: 80, height: 32 })

    const about = graph.addPage('About')
    graph.updateNode(about.id, {
      state: [{ id: 's-about', name: 'visits', type: 'number', defaultValue: 0 }]
    })
    graph.createNode('BUTTON', about.id, { name: 'about-btn', width: 80, height: 32 })
    graph.createNode('TEXT', about.id, { name: 'about-text', text: 'about' })

    const contact = graph.addPage('Contact')
    graph.updateNode(contact.id, {
      state: [{ id: 's-contact', name: 'sent', type: 'boolean', defaultValue: false }]
    })
    graph.createNode('INPUT', contact.id, { name: 'contact-input', width: 200, height: 32 })

    const reimported = await parseViaSimulatedWorker(graph)
    const pages = reimported.getPages()
    expect(pages.map((p) => p.name)).toEqual(['Home', 'About', 'Contact'])

    expect(reimported.getChildren(pages[0].id).map((n) => n.name)).toEqual(['home-btn'])
    expect(reimported.getChildren(pages[1].id).map((n) => n.name).sort()).toEqual([
      'about-btn',
      'about-text'
    ])
    expect(reimported.getChildren(pages[2].id).map((n) => n.name)).toEqual(['contact-input'])

    // Lowcode state should track with its own page.
    expect(pages[0].state?.[0].name).toBe('count')
    expect(pages[1].state?.[0].name).toBe('visits')
    expect(pages[2].state?.[0].name).toBe('sent')
  })

  test('parent/child pointers stay self-consistent after the transfer step', async () => {
    const graph = new SceneGraph()
    const p1 = graph.getPages()[0]
    graph.updateNode(p1.id, { name: 'Home' })
    graph.createNode('RECTANGLE', p1.id, { name: 'a' })
    graph.createNode('RECTANGLE', p1.id, { name: 'b' })

    const p2 = graph.addPage('About')
    graph.createNode('RECTANGLE', p2.id, { name: 'c' })
    graph.createNode('RECTANGLE', p2.id, { name: 'd' })

    const reimported = await parseViaSimulatedWorker(graph)

    // Every node's parentId.childIds must include that node, and no two
    // pages may share the same childIds array reference.
    const pages = reimported.getPages()
    const arrays = pages.map((p) => p.childIds)
    expect(arrays[0]).not.toBe(arrays[1])

    for (const node of reimported.getAllNodes()) {
      if (!node.parentId) continue
      const parent = reimported.getNode(node.parentId)
      if (!parent) throw new Error(`node ${node.id} has parentId ${node.parentId} but it is missing`)
      expect(parent.childIds).toContain(node.id)
    }
  })
})
