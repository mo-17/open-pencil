import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  INTERRUPTED_TOOL_ERROR,
  finalizeInterruptedToolParts,
  finalizeUnfinishedToolParts
} from '@/app/ai/chat/interruption'

describe('chat interruption', () => {
  test('finalizes unfinished tools without changing completed protocol results', () => {
    const messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'render',
            toolCallId: 'running',
            state: 'input-available',
            input: { jsx: '<Frame />' }
          },
          {
            type: 'dynamic-tool',
            toolName: 'describe',
            toolCallId: 'done',
            state: 'output-available',
            input: {},
            output: { ok: true }
          }
        ]
      }
    ] satisfies UIMessage[]

    const finalized = finalizeInterruptedToolParts(messages)
    expect(finalized).not.toBe(messages)
    expect(finalized[0]?.parts[0]).toEqual(
      expect.objectContaining({ state: 'output-error', errorText: INTERRUPTED_TOOL_ERROR })
    )
    expect(finalized[0]?.parts[1]).toBe(messages[0]?.parts[1])
    expect(finalizeInterruptedToolParts(finalized)).toBe(finalized)
  })

  test('can finalize unfinished tools with a provider error', () => {
    const messages = [
      {
        id: 'assistant-error',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'render',
            toolCallId: 'tool-error',
            state: 'input-available',
            input: { jsx: '<Frame />' }
          }
        ]
      }
    ] satisfies UIMessage[]

    expect(finalizeUnfinishedToolParts(messages, 'Provider disconnected')[0]?.parts[0]).toEqual({
      type: 'dynamic-tool',
      toolName: 'render',
      toolCallId: 'tool-error',
      state: 'output-error',
      input: { jsx: '<Frame />' },
      errorText: 'Provider disconnected'
    })
  })
})
