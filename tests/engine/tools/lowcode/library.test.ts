import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

describe('publish_component tool (Phase 4 §14)', () => {
  test('marks a component as published and returns a manifest entry', () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, { name: 'Shared Button' })
    graph.createNode('TEXT', component.id, { text: 'Click' })

    const result = getTool('publish_component').execute(figma, {
      component_id: component.id,
      library_id: 'design-system',
      library_name: 'Design System',
      component_key: 'component-button',
      source_kind: 'file',
      source_ref: './design-system.fig'
    }) as Result<{
      component: { key: string; name: string; version: string; nodeId: string; type: string }
      manifest: {
        libraryId: string
        name: string
        source?: { kind: string; ref: string }
        components: Array<{ key: string; version: string }>
      }
    }>

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.component).toMatchObject({
      key: 'component-button',
      name: 'Shared Button',
      nodeId: component.id,
      type: 'COMPONENT'
    })
    expect(result.data.component.version).toMatch(/^v1-[0-9a-f]{16}$/)
    expect(result.data.manifest).toMatchObject({
      libraryId: 'design-system',
      name: 'Design System',
      source: { kind: 'file', ref: './design-system.fig' }
    })
    expect(result.data.manifest.components).toEqual([result.data.component])

    const stored = graph.getNode(component.id)
    expect(stored?.componentKey).toBe('component-button')
    expect(stored?.libraryComponentKey).toBe('component-button')
    expect(stored?.libraryId).toBe('design-system')
    expect(stored?.libraryVersion).toBe(result.data.component.version)
    expect(stored?.libraryReadonly).toBe(true)
  })

  test('rejects missing source pair and non-component nodes', () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, { name: 'Rect' })

    const missingSource = getTool('publish_component').execute(figma, {
      component_id: rect.id,
      library_id: 'design-system',
      source_kind: 'file'
    }) as Result<unknown>
    expect(missingSource.ok).toBe(false)
    if (missingSource.ok) return
    expect(missingSource.error).toContain('source_ref')

    const wrongType = getTool('publish_component').execute(figma, {
      component_id: rect.id,
      library_id: 'design-system'
    }) as Result<unknown>
    expect(wrongType.ok).toBe(false)
    if (wrongType.ok) return
    expect(wrongType.error).toContain('not a COMPONENT')
  })
})
