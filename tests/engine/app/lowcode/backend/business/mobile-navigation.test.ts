import { describe, expect, test } from 'bun:test'

import { prepareBusinessModuleInstallation } from '@/app/lowcode/backend/business/installation'
import { readBusinessPageMarker } from '@/app/lowcode/backend/business/pages/markers'

import { moduleInstallationFixture } from './installation/helpers'

describe('business mobile module navigation', () => {
  test('uses the current selection event and retains the same cleanup as desktop navigation', async () => {
    const value = await moduleInstallationFixture()
    const graph = value.editor.graph
    const page = graph.getNode(value.pages.pageIds[0])
    const frame = page && graph.getChildren(page.id)[0]
    if (!frame) throw new Error('Missing business page')
    const mobile = graph
      .getChildren(frame.id)
      .find((node) => readBusinessPageMarker(node)?.role === 'mobile-navigation')
    if (!mobile) throw new Error('Missing mobile navigation')
    const handlers = mobile.events?.onChange ?? []
    expect(handlers.length).toBeGreaterThan(1)
    expect(
      handlers.every(
        (handler) => handler.kind === 'condition' && handler.condExpr.startsWith('$value === ')
      )
    ).toBe(true)
    const first = handlers[0]
    if (first.kind !== 'condition') throw new Error('Missing navigation condition')
    expect(first.consequent.at(-1)?.kind).toBe('navigate')
    expect(first.consequent.some((action) => action.kind === 'setState')).toBe(true)
    expect(first.consequent.some((action) => action.kind === 'backendCommand')).toBe(false)
  })

  test('appends installed module choices and restores the exact mobile node on undo', async () => {
    const value = await moduleInstallationFixture()
    const graph = value.editor.graph
    const mobile = [...graph.getAllNodes()].find(
      (node) => readBusinessPageMarker(node)?.role === 'mobile-navigation'
    )
    if (!mobile) throw new Error('Missing mobile navigation')
    graph.updateNode(mobile.id, {
      interactiveProps: { ...mobile.interactiveProps, ariaLabel: 'My mobile navigation' }
    })
    const before = structuredClone(mobile)
    const plan = prepareBusinessModuleInstallation({ ...value, kind: 'service-desk' })
    plan.apply()
    const after = structuredClone(graph.getNode(mobile.id))
    const options = after?.interactiveProps?.options
    expect(Array.isArray(options)).toBe(true)
    if (!Array.isArray(options)) throw new Error('Missing mobile choices')
    expect(options).toContain('Tickets')
    expect(after?.interactiveProps?.ariaLabel).toBe('My mobile navigation')
    expect(after?.events?.onChange?.length).toBeGreaterThan(before.events?.onChange?.length ?? 0)
    value.editor.undo.undo()
    expect(graph.getNode(mobile.id)).toEqual(before)
    value.editor.undo.redo()
    expect(graph.getNode(mobile.id)).toEqual(after)
  })
})
