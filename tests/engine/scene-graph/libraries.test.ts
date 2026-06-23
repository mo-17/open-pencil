import { describe, expect, test } from 'bun:test'

import {
  componentSubtreeVersion,
  publishLibraryComponent,
  SceneGraph
} from '@open-pencil/core/scene-graph'

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
})
