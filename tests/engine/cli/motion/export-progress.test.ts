import { describe, expect, test } from 'bun:test'

import { createMotionExportProgressReporter } from '#cli/commands/motion/export-progress'

describe('Motion export CLI progress', () => {
  test('reports phase starts, ten-percent boundaries, and completion without frame spam', () => {
    const messages: string[] = []
    const report = createMotionExportProgressReporter((message) => messages.push(message))

    report({ phase: 'prepare', completed: 0, total: 1 })
    report({ phase: 'prepare', completed: 1, total: 1 })
    report({ phase: 'render', completed: 0, total: 20 })
    report({ phase: 'render', completed: 1, total: 20, frameIndex: 0 })
    report({ phase: 'render', completed: 2, total: 20, frameIndex: 1 })
    report({ phase: 'render', completed: 3, total: 20, frameIndex: 2 })
    report({ phase: 'render', completed: 20, total: 20, frameIndex: 19 })

    expect(messages).toHaveLength(5)
    expect(messages[0]).toContain('prepare: 0/1 (0%)')
    expect(messages[1]).toContain('prepare: 1/1 (100%)')
    expect(messages[2]).toContain('render: 0/20 (0%)')
    expect(messages[3]).toContain('render: 2/20 (10%)')
    expect(messages[4]).toContain('render: 20/20 (100%)')
  })
})
