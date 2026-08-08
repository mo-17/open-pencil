import { describe, expect, test } from 'bun:test'

import {
  buildCompileDiagnostics,
  summarizeCompileDiagnostics
} from '@/app/lowcode/preview-pane/compile-diagnostics'

describe('lowcode preview compile diagnostics', () => {
  test('places a compile error before compiler warnings and preserves node targets', () => {
    const diagnostics = buildCompileDiagnostics(
      [
        { code: 'font-face-unavailable', message: 'Font is unavailable', nodeId: 'text-1' },
        { code: 'multi-page-duplicate-slug', message: 'Duplicate route' }
      ],
      '  Preview update failed  '
    )

    expect(diagnostics).toEqual([
      {
        severity: 'error',
        code: 'preview-compile-error',
        message: 'Preview update failed'
      },
      {
        severity: 'warning',
        code: 'font-face-unavailable',
        message: 'Font is unavailable',
        nodeId: 'text-1'
      },
      {
        severity: 'warning',
        code: 'multi-page-duplicate-slug',
        message: 'Duplicate route'
      }
    ])
  })

  test('counts errors and warnings independently', () => {
    expect(
      summarizeCompileDiagnostics(
        [
          { code: 'motion-invalid', message: 'Invalid MotionSpec', nodeId: 'node-1' },
          { code: 'route-pattern-invalid', message: 'Invalid route', nodeId: 'page-1' }
        ],
        'Compile failed'
      )
    ).toMatchObject({ errorCount: 1, warningCount: 2, total: 3 })
  })

  test('ignores blank errors and returns an empty summary without warnings', () => {
    expect(summarizeCompileDiagnostics([], '   ')).toEqual({
      items: [],
      errorCount: 0,
      warningCount: 0,
      total: 0
    })
  })
})
