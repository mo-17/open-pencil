import { describe, expect, test } from 'bun:test'

import { parseStaticAccessibilityReport } from '@/app/plugins/accessibility-report'

describe('static accessibility report view model', () => {
  test('accepts bounded host data and limits rendered issues', () => {
    const issues = Array.from({ length: 105 }, (_, index) => ({
      ruleId: 'contrast',
      severity: index === 0 ? 'error' : 'warning',
      message: `Issue ${index}`,
      nodeId: `node-${index}`,
      nodeName: `Node ${index}`,
      nodePath: ['Page', `Node ${index}`]
    }))
    const report = parseStaticAccessibilityReport({
      kind: 'static-accessibility-audit',
      scope: 'document',
      errorCount: 1,
      warningCount: 104,
      infoCount: 0,
      issueCount: 105,
      truncated: false,
      issues,
      notEvaluated: ['runtime focus order']
    })
    expect(report?.issues).toHaveLength(100)
    expect(report?.truncated).toBe(true)
    expect(report?.notEvaluated).toEqual(['runtime focus order'])
  })

  test('rejects malformed or executable-shaped data', () => {
    expect(parseStaticAccessibilityReport(undefined)).toBeNull()
    expect(
      parseStaticAccessibilityReport({
        kind: 'static-accessibility-audit',
        scope: 'document',
        errorCount: 0,
        warningCount: 0,
        infoCount: 1,
        issueCount: 1,
        truncated: false,
        issues: [
          {
            ruleId: 'rule',
            severity: 'info',
            message: 'message',
            nodeId: 'node',
            nodeName: 'Node',
            nodePath: ['Page'],
            suggestion: { html: '<script>' }
          }
        ],
        notEvaluated: []
      })
    ).toBeNull()
  })
})
