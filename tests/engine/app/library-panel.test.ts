import { expect, test } from 'bun:test'

import { reactive } from 'vue'

import {
  importLibraryComponent,
  publishLibraryComponent,
  SceneGraph,
  type LibraryManifest
} from '@open-pencil/scene-graph'

import {
  cloneSceneGraphForLibraryUndo,
  libraryPanelRows,
  parseLibraryManifestText
} from '@/app/lowcode/libraries'

test('parseLibraryManifestText validates the manifest shape', () => {
  const manifest = parseLibraryManifestText(
    JSON.stringify({
      libraryId: 'design-system',
      name: 'Design System',
      source: { kind: 'file', ref: 'library.fig' },
      components: [
        {
          key: 'component-card',
          name: 'Card',
          version: 'v1',
          nodeId: '0:1',
          type: 'COMPONENT'
        }
      ]
    })
  )

  expect(manifest.libraryId).toBe('design-system')
  expect(manifest.components[0]?.key).toBe('component-card')
  expect(() => parseLibraryManifestText('{"libraryId":"x"}')).toThrow(
    'manifest.name must be a non-empty string'
  )
})

test('libraryPanelRows reports imported component update status', () => {
  const source = createLibrarySource('Hello')
  const target = new SceneGraph()
  const published = publishLibraryComponent(source.graph, {
    componentId: source.componentId,
    libraryId: 'design-system',
    libraryName: 'Design System',
    componentKey: 'component-card',
    source: { kind: 'file', ref: 'library.fig' }
  })
  if ('error' in published) throw new Error(published.error)
  const imported = importLibraryComponent({
    sourceGraph: source.graph,
    targetGraph: target,
    manifest: published.manifest,
    componentKey: 'component-card'
  })
  if ('error' in imported) throw new Error(imported.error)

  const nextManifest: LibraryManifest = {
    ...published.manifest,
    components: [{ ...firstComponent(published.manifest), version: 'v2' }]
  }

  expect(libraryPanelRows(target)).toMatchObject([
    {
      libraryId: 'design-system',
      componentKey: 'component-card',
      currentVersion: published.component.version,
      status: 'unknown'
    }
  ])
  expect(libraryPanelRows(target, nextManifest)).toMatchObject([
    {
      libraryId: 'design-system',
      componentKey: 'component-card',
      currentVersion: published.component.version,
      latestVersion: 'v2',
      status: 'outdated'
    }
  ])
})

test('cloneSceneGraphForLibraryUndo preserves root library refs and instance index', () => {
  const graph = new SceneGraph()
  const page = firstPage(graph)
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'Card',
    libraryComponentKey: 'component-card',
    libraryId: 'design-system',
    libraryVersion: 'v1',
    libraryReadonly: true
  })
  const instance = graph.createInstance(component.id, page.id)
  graph.updateNode(graph.rootId, {
    lowcodeLibraries: [
      {
        libraryId: 'design-system',
        name: 'Design System',
        source: { kind: 'file', ref: 'library.fig' },
        importedComponents: [{ key: 'component-card', version: 'v1' }]
      }
    ]
  })

  const clone = cloneSceneGraphForLibraryUndo(graph)
  expect(clone).not.toBe(graph)
  expect(clone.getNode(clone.rootId)?.lowcodeLibraries).toEqual(
    graph.getNode(graph.rootId)?.lowcodeLibraries
  )
  expect(clone.getNode(component.id)?.libraryComponentKey).toBe('component-card')
  expect(clone.getInstances(component.id).map((node) => node.id)).toEqual([instance.id])
})

test('cloneSceneGraphForLibraryUndo unwraps reactive graph nodes', () => {
  const graph = new SceneGraph()
  const page = firstPage(graph)
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'Card',
    libraryComponentKey: 'component-card',
    libraryId: 'design-system',
    libraryVersion: 'v1',
    libraryReadonly: true
  })
  const componentNode = graph.getNode(component.id)
  if (!componentNode) throw new Error('Expected component node')
  graph.nodes.set(component.id, reactive(componentNode))

  const clone = cloneSceneGraphForLibraryUndo(graph)

  expect(clone.getNode(component.id)).toMatchObject({
    name: 'Card',
    libraryComponentKey: 'component-card',
    libraryVersion: 'v1'
  })
})

function createLibrarySource(text: string): { graph: SceneGraph; componentId: string } {
  const graph = new SceneGraph()
  const page = firstPage(graph)
  const component = graph.createNode('COMPONENT', page.id, { name: 'Card', width: 240, height: 80 })
  graph.createNode('TEXT', component.id, {
    name: 'Title',
    text,
    width: 120,
    height: 24
  })
  return { graph, componentId: component.id }
}

function firstPage(graph: SceneGraph) {
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected a default page')
  return page
}

function firstComponent(manifest: LibraryManifest) {
  const component = manifest.components[0]
  if (!component) throw new Error('Expected a manifest component')
  return component
}
