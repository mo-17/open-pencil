import { describe, expect, test } from 'bun:test'

import {
  acceptLibraryUpdate,
  checkLibraryUpdates,
  componentSubtreeVersion,
  importLibraryComponent,
  publishLibraryComponent,
  SceneGraph
} from '@open-pencil/scene-graph'

describe('team-library scene-graph helpers (Phase 4 §14)', () => {
  test('publishes a component with a deterministic subtree version', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, { name: 'Card' })
    graph.createNode('TEXT', component.id, { name: 'Title', text: 'Hello' })

    const first = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      libraryName: 'Design System',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in first).toBe(false)
    if ('error' in first) return

    const stored = graph.getNode(component.id)
    expect(stored?.componentKey).toBe('component-card')
    expect(stored?.libraryComponentKey).toBe('component-card')
    expect(stored?.libraryId).toBe('design-system')
    expect(stored?.libraryVersion).toBe(first.component.version)
    expect(stored?.libraryReadonly).toBe(true)
    expect(first.manifest).toEqual({
      libraryId: 'design-system',
      name: 'Design System',
      source: { kind: 'file', ref: './design-system.fig' },
      components: [first.component]
    })

    const second = publishLibraryComponent(graph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card'
    })
    expect('error' in second).toBe(false)
    if ('error' in second) return
    expect(second.component.version).toBe(first.component.version)
  })

  test('subtree version changes when component content changes', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, { name: 'Card' })
    const title = graph.createNode('TEXT', component.id, { name: 'Title', text: 'Hello' })

    const before = componentSubtreeVersion(graph, component.id)
    graph.updateNode(title.id, { text: 'Updated' })
    const after = componentSubtreeVersion(graph, component.id)

    expect(after).not.toBe(before)
    expect(after).toMatch(/^v1-[0-9a-f]{16}$/)
  })

  test('rejects non-component nodes', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, { name: 'Rect' })

    const result = publishLibraryComponent(graph, {
      componentId: rect.id,
      libraryId: 'design-system'
    })

    expect(result).toEqual({ error: `Node "${rect.id}" is not a COMPONENT or COMPONENT_SET` })
  })

  test('imports a published component into another graph', () => {
    const sourceGraph = new SceneGraph()
    const sourcePage = sourceGraph.getPages()[0]
    const component = sourceGraph.createNode('COMPONENT', sourcePage.id, { name: 'Card' })
    graphCreateTitle(sourceGraph, component.id, 'Hello')
    const published = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      libraryName: 'Design System',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return

    const targetGraph = new SceneGraph()
    const result = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: published.manifest,
      componentKey: 'component-card'
    })
    expect('error' in result).toBe(false)
    if ('error' in result) return

    const imported = targetGraph.getNode(result.importedNodeId)
    expect(imported?.type).toBe('COMPONENT')
    expect(imported?.id).not.toBe(component.id)
    expect(imported?.componentKey).toBe('component-card')
    expect(imported?.libraryComponentKey).toBe('component-card')
    expect(imported?.libraryId).toBe('design-system')
    expect(imported?.libraryVersion).toBe(published.component.version)
    expect(imported?.libraryReadonly).toBe(true)

    const importedTitle = imported?.childIds
      .map((id) => targetGraph.getNode(id))
      .find((node) => node?.type === 'TEXT')
    expect(importedTitle?.text).toBe('Hello')

    const root = targetGraph.getNode(targetGraph.rootId)
    expect(root?.lowcodeLibraries).toEqual([
      {
        libraryId: 'design-system',
        name: 'Design System',
        source: { kind: 'file', ref: './design-system.fig' },
        importedComponents: [{ key: 'component-card', version: published.component.version }]
      }
    ])
  })

  test('updates imported component metadata without duplicating the library ref', () => {
    const sourceGraph = new SceneGraph()
    const sourcePage = sourceGraph.getPages()[0]
    const component = sourceGraph.createNode('COMPONENT', sourcePage.id, { name: 'Card' })
    const title = graphCreateTitle(sourceGraph, component.id, 'Hello')
    const first = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in first).toBe(false)
    if ('error' in first) return

    const targetGraph = new SceneGraph()
    const importedFirst = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: first.manifest,
      componentKey: 'component-card'
    })
    expect('error' in importedFirst).toBe(false)
    if ('error' in importedFirst) return

    sourceGraph.updateNode(title.id, { text: 'Updated' })
    const second = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      libraryName: 'Design System',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in second).toBe(false)
    if ('error' in second) return

    const importedSecond = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: second.manifest,
      componentKey: 'component-card'
    })
    expect('error' in importedSecond).toBe(false)
    if ('error' in importedSecond) return

    const root = targetGraph.getNode(targetGraph.rootId)
    expect(root?.lowcodeLibraries).toHaveLength(1)
    expect(root?.lowcodeLibraries?.[0]?.importedComponents).toEqual([
      { key: 'component-card', version: second.component.version }
    ])
    expect(second.component.version).not.toBe(first.component.version)
  })

  test('copies imported component image assets into the target graph', () => {
    const sourceGraph = new SceneGraph()
    const sourcePage = sourceGraph.getPages()[0]
    const component = sourceGraph.createNode('COMPONENT', sourcePage.id, { name: 'Image Card' })
    sourceGraph.createNode('RECTANGLE', component.id, {
      name: 'Hero',
      fills: [
        {
          type: 'IMAGE',
          visible: true,
          opacity: 1,
          imageHash: 'hero-hash',
          scaleMode: 'FILL'
        }
      ]
    })
    sourceGraph.images.set('hero-hash', new Uint8Array([1, 2, 3]))
    const published = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'image-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in published).toBe(false)
    if ('error' in published) return

    const targetGraph = new SceneGraph()
    const result = importLibraryComponent({
      sourceGraph,
      targetGraph,
      manifest: published.manifest,
      componentKey: 'image-card'
    })
    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(Array.from(targetGraph.images.get('hero-hash') ?? [])).toEqual([1, 2, 3])
    expect(targetGraph.images.get('hero-hash')).not.toBe(sourceGraph.images.get('hero-hash'))
  })

  test('rejects import requests without a resolvable component or source', () => {
    const sourceGraph = new SceneGraph()
    const targetGraph = new SceneGraph()
    const manifest = {
      libraryId: 'design-system',
      name: 'Design System',
      components: [
        {
          key: 'missing-card',
          name: 'Missing Card',
          version: 'v1-missing',
          nodeId: 'missing',
          type: 'COMPONENT' as const
        }
      ]
    }

    expect(
      importLibraryComponent({
        sourceGraph,
        targetGraph,
        manifest,
        componentKey: 'missing-key',
        source: { kind: 'file', ref: './design-system.fig' }
      })
    ).toEqual({ error: 'Component key "missing-key" not found in library manifest' })
    expect(
      importLibraryComponent({
        sourceGraph,
        targetGraph,
        manifest,
        componentKey: 'missing-card'
      })
    ).toEqual({ error: 'library source is required to register imported components' })
    expect(
      importLibraryComponent({
        sourceGraph,
        targetGraph,
        manifest,
        componentKey: 'missing-card',
        parentId: 'missing-parent',
        source: { kind: 'file', ref: './design-system.fig' }
      })
    ).toEqual({ error: 'Target parent "missing-parent" not found' })
    expect(
      importLibraryComponent({
        sourceGraph,
        targetGraph,
        manifest,
        componentKey: 'missing-card',
        source: { kind: 'file', ref: './design-system.fig' }
      })
    ).toEqual({ error: 'Source component "missing-card" not found in source graph' })
  })

  test('checks imported library component update status', () => {
    const { sourceGraph, targetGraph, component, importedNodeId, first } = createImportedCard()

    expect(checkLibraryUpdates({ targetGraph, manifest: first.manifest })).toEqual([
      {
        libraryId: 'design-system',
        componentKey: 'component-card',
        status: 'up-to-date',
        cachedNodeId: importedNodeId,
        currentVersion: first.component.version,
        latestVersion: first.component.version
      }
    ])

    const title = sourceGraph.getChildren(component.id).find((node) => node.type === 'TEXT')
    expect(title).toBeDefined()
    sourceGraph.updateNode(title?.id ?? '', { text: 'Updated' })
    const second = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      libraryName: 'Design System',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in second).toBe(false)
    if ('error' in second) return

    expect(checkLibraryUpdates({ targetGraph, manifest: second.manifest })).toEqual([
      {
        libraryId: 'design-system',
        componentKey: 'component-card',
        status: 'outdated',
        cachedNodeId: importedNodeId,
        currentVersion: first.component.version,
        latestVersion: second.component.version
      }
    ])

    const missingManifest = {
      libraryId: 'design-system',
      name: 'Design System',
      source: { kind: 'file' as const, ref: './design-system.fig' },
      components: []
    }
    expect(checkLibraryUpdates({ targetGraph, manifest: missingManifest })).toEqual([
      {
        libraryId: 'design-system',
        componentKey: 'component-card',
        status: 'missing-manifest',
        currentVersion: first.component.version
      }
    ])

    targetGraph.deleteNode(importedNodeId)
    expect(checkLibraryUpdates({ targetGraph, manifest: second.manifest })).toEqual([
      {
        libraryId: 'design-system',
        componentKey: 'component-card',
        status: 'missing-cached-master',
        currentVersion: first.component.version,
        latestVersion: second.component.version
      }
    ])
  })

  test('accepts a library update while preserving cached master id and syncing instances', () => {
    const { sourceGraph, targetGraph, component, importedNodeId, first } = createImportedCard()
    const targetPage = targetGraph.getPages()[0]
    const instance = targetGraph.createInstance(importedNodeId, targetPage.id)
    expect(instance).not.toBeNull()
    if (!instance) return
    const originalInstanceChild = targetGraph.getChildren(instance.id)[0]
    const originalCachedChildId = targetGraph.getNode(importedNodeId)?.childIds[0]

    const title = sourceGraph.getChildren(component.id).find((node) => node.type === 'TEXT')
    expect(title).toBeDefined()
    sourceGraph.updateNode(title?.id ?? '', { text: 'Updated' })
    const second = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      libraryName: 'Design System',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in second).toBe(false)
    if ('error' in second) return

    const accepted = acceptLibraryUpdate({
      sourceGraph,
      targetGraph,
      manifest: second.manifest,
      componentKey: 'component-card'
    })
    expect('error' in accepted).toBe(false)
    if ('error' in accepted) return

    expect(accepted.cachedNodeId).toBe(importedNodeId)
    expect(accepted.previousVersion).toBe(first.component.version)
    expect(accepted.warnings).toEqual([])
    expect(targetGraph.getNode(importedNodeId)?.libraryVersion).toBe(second.component.version)
    expect(targetGraph.getNode(importedNodeId)?.childIds[0]).toBe(originalCachedChildId)
    expect(targetGraph.getNode(originalCachedChildId ?? '')?.text).toBe('Updated')
    expect(targetGraph.getChildren(instance.id)).toHaveLength(1)
    expect(targetGraph.getNode(originalInstanceChild?.id ?? '')?.text).toBe('Updated')
    expect(
      targetGraph.getNode(targetGraph.rootId)?.lowcodeLibraries?.[0]?.importedComponents
    ).toEqual([{ key: 'component-card', version: second.component.version }])
  })

  test('accepts structure-changing updates with a warning', () => {
    const { sourceGraph, targetGraph, component, importedNodeId } = createImportedCard()
    graphCreateTitle(sourceGraph, component.id, 'Subtitle')
    const next = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      libraryName: 'Design System',
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in next).toBe(false)
    if ('error' in next) return

    const accepted = acceptLibraryUpdate({
      sourceGraph,
      targetGraph,
      manifest: next.manifest,
      componentKey: 'component-card'
    })
    expect('error' in accepted).toBe(false)
    if ('error' in accepted) return

    expect(accepted.cachedNodeId).toBe(importedNodeId)
    expect(accepted.warnings).toEqual([
      'Component structure changed; existing instance overrides were not remapped'
    ])
    expect(targetGraph.getNode(importedNodeId)?.childIds).toHaveLength(2)
  })

  test('rejects library update requests without matching source or cached master', () => {
    const { sourceGraph, targetGraph, component, first, importedNodeId } = createImportedCard()
    const missingKey = acceptLibraryUpdate({
      sourceGraph,
      targetGraph,
      manifest: first.manifest,
      componentKey: 'missing-key'
    })
    expect(missingKey).toEqual({
      error: 'Component key "missing-key" not found in library manifest'
    })

    targetGraph.deleteNode(importedNodeId)
    const missingCached = acceptLibraryUpdate({
      sourceGraph,
      targetGraph,
      manifest: first.manifest,
      componentKey: 'component-card'
    })
    expect(missingCached).toEqual({
      error: 'Cached component "component-card" not found in target graph'
    })

    const next = publishLibraryComponent(sourceGraph, {
      componentId: component.id,
      libraryId: 'design-system',
      componentKey: 'component-card'
    })
    expect('error' in next).toBe(false)
    if ('error' in next) return
    const targetWithoutSource = new SceneGraph()
    const imported = importLibraryComponent({
      sourceGraph,
      targetGraph: targetWithoutSource,
      manifest: next.manifest,
      componentKey: 'component-card',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect('error' in imported).toBe(false)
    if ('error' in imported) return
    targetWithoutSource.updateNode(targetWithoutSource.rootId, { lowcodeLibraries: [] })
    expect(
      acceptLibraryUpdate({
        sourceGraph,
        targetGraph: targetWithoutSource,
        manifest: next.manifest,
        componentKey: 'component-card'
      })
    ).toEqual({ error: 'library source is required to update imported components' })
  })
})

function graphCreateTitle(graph: SceneGraph, parentId: string, text: string) {
  return graph.createNode('TEXT', parentId, { name: 'Title', text })
}

function createImportedCard() {
  const sourceGraph = new SceneGraph()
  const sourcePage = sourceGraph.getPages()[0]
  const component = sourceGraph.createNode('COMPONENT', sourcePage.id, { name: 'Card' })
  graphCreateTitle(sourceGraph, component.id, 'Hello')
  const first = publishLibraryComponent(sourceGraph, {
    componentId: component.id,
    libraryId: 'design-system',
    libraryName: 'Design System',
    componentKey: 'component-card',
    source: { kind: 'file', ref: './design-system.fig' }
  })
  expect('error' in first).toBe(false)
  if ('error' in first) throw new Error(first.error)
  const targetGraph = new SceneGraph()
  const imported = importLibraryComponent({
    sourceGraph,
    targetGraph,
    manifest: first.manifest,
    componentKey: 'component-card'
  })
  expect('error' in imported).toBe(false)
  if ('error' in imported) throw new Error(imported.error)
  return {
    sourceGraph,
    targetGraph,
    component,
    first,
    importedNodeId: imported.importedNodeId
  }
}
