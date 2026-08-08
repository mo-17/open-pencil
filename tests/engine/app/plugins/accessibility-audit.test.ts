import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import { runStaticAccessibilityAudit } from '@/app/plugins/host/accessibility-audit'

describe('static accessibility audit plugin', () => {
  test('returns a bounded structured report and names unsupported dynamic checks', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Card',
      width: 200,
      height: 80,
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 1, g: 1, b: 1 } }]
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Label',
      width: 80,
      height: 20,
      text: 'Low contrast',
      fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0.82, g: 0.82, b: 0.82 } }]
    })

    const result = runStaticAccessibilityAudit({ graph } as EditorStore)

    expect(result.kind).toBe('static-accessibility-audit')
    expect(result.scope).toBe('document')
    expect(result.issueCount).toBeGreaterThan(0)
    expect(result.issues.length).toBeLessThanOrEqual(2_000)
    expect(result.issues.some((issue) => issue.ruleId === 'color-contrast')).toBe(true)
    expect(result.notEvaluated.some((item) => item.includes('keyboard focus'))).toBe(true)
  })

  test('marks reports partial when a single node exceeds traversal bounds', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Large frame' })
    for (let index = 0; index < 2_001; index++) {
      graph.createNode('RECTANGLE', frame.id, { name: `Item ${index}` })
    }

    const result = runStaticAccessibilityAudit({ graph } as EditorStore)

    expect(result.truncated).toBe(true)
    expect(result.notEvaluated).toContain('content beyond the static audit resource limits')
  })

  test('marks reports partial when aggregate capture budgets are exhausted', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const fills = Array.from({ length: 256 }, () => ({
      type: 'SOLID' as const,
      visible: true,
      opacity: 1,
      color: { r: 1, g: 1, b: 1 }
    }))
    const text = 'x'.repeat(4_096)
    for (let index = 0; index < 65; index++) {
      graph.createNode('FRAME', page.id, { name: `Dense ${index}`, text, fills })
    }

    const result = runStaticAccessibilityAudit({ graph } as EditorStore)

    expect(result.truncated).toBe(true)
    expect(result.notEvaluated).toContain('content beyond the static audit resource limits')
  })
})
