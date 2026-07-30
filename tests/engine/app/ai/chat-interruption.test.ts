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

  test('closes responded approvals when a request is interrupted and stays idempotent', () => {
    const messages = [
      {
        id: 'assistant-approval',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'mcp__docs__search',
            toolCallId: 'approved',
            title: 'Search docs',
            state: 'approval-responded',
            input: { query: 'approval lifecycle' },
            approval: { id: 'approval-true', approved: true }
          },
          {
            type: 'dynamic-tool',
            toolName: 'mcp__docs__delete',
            toolCallId: 'denied',
            state: 'approval-responded',
            input: { id: 'document-1' },
            approval: { id: 'approval-false', approved: false, reason: 'Keep it' }
          },
          {
            type: 'dynamic-tool',
            toolName: 'mcp__docs__publish',
            toolCallId: 'waiting',
            state: 'approval-requested',
            input: { id: 'document-2' },
            approval: { id: 'approval-waiting' }
          }
        ]
      }
    ] satisfies UIMessage[]

    const finalized = finalizeInterruptedToolParts(messages)

    expect(finalized[0]?.parts[0]).toEqual({
      type: 'dynamic-tool',
      toolName: 'mcp__docs__search',
      toolCallId: 'approved',
      title: 'Search docs',
      state: 'output-error',
      input: { query: 'approval lifecycle' },
      approval: { id: 'approval-true', approved: true },
      errorText: INTERRUPTED_TOOL_ERROR
    })
    expect(finalized[0]?.parts[1]).toEqual({
      type: 'dynamic-tool',
      toolName: 'mcp__docs__delete',
      toolCallId: 'denied',
      state: 'output-denied',
      input: { id: 'document-1' },
      approval: { id: 'approval-false', approved: false, reason: 'Keep it' }
    })
    expect(finalized[0]?.parts[2]).toBe(messages[0]?.parts[2])
    expect(finalizeInterruptedToolParts(finalized)).toBe(finalized)
  })

  test('can finalize unfinished tools and responded approvals with a provider error', () => {
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
          },
          {
            type: 'dynamic-tool',
            toolName: 'mcp__docs__search',
            toolCallId: 'approved-error',
            state: 'approval-responded',
            input: { query: 'provider error' },
            approval: { id: 'approval-approved-error', approved: true }
          },
          {
            type: 'dynamic-tool',
            toolName: 'mcp__docs__delete',
            toolCallId: 'denied-error',
            state: 'approval-responded',
            input: { id: 'document-3' },
            approval: { id: 'approval-denied-error', approved: false }
          }
        ]
      }
    ] satisfies UIMessage[]

    const finalized = finalizeUnfinishedToolParts(messages, 'Provider disconnected')

    expect(finalized[0]?.parts[0]).toEqual({
      type: 'dynamic-tool',
      toolName: 'render',
      toolCallId: 'tool-error',
      state: 'output-error',
      input: { jsx: '<Frame />' },
      errorText: 'Provider disconnected'
    })
    expect(finalized[0]?.parts[1]).toEqual({
      type: 'dynamic-tool',
      toolName: 'mcp__docs__search',
      toolCallId: 'approved-error',
      state: 'output-error',
      input: { query: 'provider error' },
      approval: { id: 'approval-approved-error', approved: true },
      errorText: 'Provider disconnected'
    })
    expect(finalized[0]?.parts[2]).toEqual({
      type: 'dynamic-tool',
      toolName: 'mcp__docs__delete',
      toolCallId: 'denied-error',
      state: 'output-denied',
      input: { id: 'document-3' },
      approval: { id: 'approval-denied-error', approved: false }
    })
    expect(finalizeUnfinishedToolParts(finalized, 'Provider disconnected')).toBe(finalized)
  })
})
