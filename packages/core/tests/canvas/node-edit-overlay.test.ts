import { test, expect } from 'bun:test'

import { computeHandleVisibleVertices } from '#core/canvas/node-edit-overlay'

test('ignores stale selected handle indices', () => {
  const segments = [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }]
  expect(computeHandleVisibleVertices(new Set([0]), new Set([99, -1, 2]), segments)).toEqual(
    new Set([0, 1])
  )
})
