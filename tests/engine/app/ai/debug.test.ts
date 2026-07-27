import { describe, expect, test } from 'bun:test'

import type { ToolDebugLog } from '@open-pencil/core/tools'

import { formatDiagnostics } from '@/app/ai/debug'

describe('AI debug diagnostics', () => {
  test('labels all locally collected tool metrics as direct/local', () => {
    const log: ToolDebugLog = {
      entries: [
        {
          tool: 'update_node',
          args: { id: 'node-1' },
          result: undefined,
          error: 'failed',
          timestamp: 0,
          durationMs: 10,
          mutates: true
        }
      ],
      duplicates: [],
      noopMutations: [],
      totalResultBytes: 2048
    }

    expect(formatDiagnostics(log).split('\n').slice(0, 4)).toEqual([
      'Direct/local tool executions: 1',
      'Direct/local total result payload: 2.0 KB',
      'Direct/local mutating calls: 1',
      'Direct/local errors: 1'
    ])
  })
})
