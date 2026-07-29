import { describe, expect, test } from 'bun:test'

import { createMotionPreset } from '@open-pencil/scene-graph'

import { createFigmaMotionAdapterView } from '@/app/properties/figma-motion-adapter'

describe('Figma native Motion property adapter', () => {
  test('emits a deterministic, selection-based safe script for compatible motion', () => {
    const node = { motion: createMotionPreset('fade-in'), opacity: 0.4 }
    const first = createFigmaMotionAdapterView(node)
    const second = createFigmaMotionAdapterView(node)

    expect(first.plan.supported).toBe(true)
    expect(first.plan.operations[0]?.field.name).toBe('OPACITY')
    expect(first.plan.operations[0]?.track.baseValue.value).toBe(0.4)
    expect(first.script).toBe(second.script)
    expect(first.script).toContain('figma.currentPage.selection')
    expect(first.script).toContain('"conflictPolicy": "replace-owned"')
    expect(first.script).toContain('"allowTimelineGrowth": false')
    expect(first.script).not.toContain('figma.getNodeByIdAsync')
  })

  test('fails closed and does not expose a script for unsupported behavior', () => {
    const result = createFigmaMotionAdapterView({
      motion: createMotionPreset('hover-lift'),
      opacity: 1
    })

    expect(result.plan.supported).toBe(false)
    expect(result.plan.operations).toEqual([])
    expect(result.plan.issues.map((issue) => issue.code)).toContain('trigger')
    expect(result.script).toBeNull()
  })
})
