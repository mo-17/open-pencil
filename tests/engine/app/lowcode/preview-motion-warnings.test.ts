import { describe, expect, test } from 'bun:test'

import { onlyMotionWarnings } from '@/app/lowcode/preview-pane/use-compile-on-change'

describe('lowcode preview Motion warnings', () => {
  test('keeps only compiler warnings owned by Motion', () => {
    expect(
      onlyMotionWarnings([
        { code: 'motion-invalid', message: 'Invalid MotionSpec', nodeId: 'node-1' },
        { code: 'action-play-motion-stale-track', message: 'Stale action track' },
        { code: 'motion-channel-conflict', message: 'Later track wins', nodeId: 'node-2' }
      ])
    ).toEqual([
      { code: 'motion-invalid', message: 'Invalid MotionSpec', nodeId: 'node-1' },
      { code: 'motion-channel-conflict', message: 'Later track wins', nodeId: 'node-2' }
    ])
  })

  test('returns a fresh empty array when the compile has no Motion warnings', () => {
    const warnings = [{ code: 'layout-overflow', message: 'Overflow' }]
    const result = onlyMotionWarnings(warnings)
    expect(result).toEqual([])
    expect(result).not.toBe(warnings)
  })
})
