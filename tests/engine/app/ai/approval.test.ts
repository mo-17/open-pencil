import { describe, expect, test } from 'bun:test'

import {
  finalizePendingToolApprovals,
  hasPendingToolApproval,
  isCurrentToolApprovalContext,
  type ToolApprovalContext
} from '@/app/ai/chat/approval'

describe('tool approval routing', () => {
  test('accepts only the published chat generation, tab, and provider identity', () => {
    const chat = { id: 'chat-a' }
    const context: ToolApprovalContext<typeof chat> = {
      chat,
      generation: 3,
      sessionRevision: 7,
      tabId: 'tab-a',
      providerID: 'openai'
    }

    expect(isCurrentToolApprovalContext(context, chat, 3, 7, 'tab-a', 'openai')).toBeTrue()
    expect(
      isCurrentToolApprovalContext(context, { id: 'chat-a' }, 3, 7, 'tab-a', 'openai')
    ).toBeFalse()
    expect(isCurrentToolApprovalContext(context, chat, 4, 7, 'tab-a', 'openai')).toBeFalse()
    expect(isCurrentToolApprovalContext(context, chat, 3, 8, 'tab-a', 'openai')).toBeFalse()
    expect(isCurrentToolApprovalContext(context, chat, 3, 7, 'tab-b', 'openai')).toBeFalse()
    expect(isCurrentToolApprovalContext(context, chat, 3, 7, 'tab-a', 'openrouter')).toBeFalse()
  })

  test('requires the same message and a still-pending approval part', () => {
    const pending = {
      id: 'assistant-1',
      role: 'assistant' as const,
      parts: [
        {
          type: 'dynamic-tool' as const,
          toolName: 'mcp__mcp-0123456789abcdef__read',
          toolCallId: 'call-1',
          state: 'approval-requested' as const,
          input: { query: 'safe visible input' },
          approval: { id: 'approval-1' }
        }
      ]
    }

    expect(hasPendingToolApproval([pending], 'assistant-1', 'approval-1')).toBeTrue()
    expect(
      hasPendingToolApproval(
        [pending, { id: 'user-later', role: 'user', parts: [{ type: 'text', text: 'Continue' }] }],
        'assistant-1',
        'approval-1'
      )
    ).toBeFalse()
    expect(hasPendingToolApproval([pending], 'assistant-old', 'approval-1')).toBeFalse()
    expect(hasPendingToolApproval([pending], 'assistant-1', 'approval-old')).toBeFalse()
    expect(
      hasPendingToolApproval(
        [
          {
            ...pending,
            parts: [{ ...pending.parts[0], state: 'approval-responded' as const }]
          }
        ],
        'assistant-1',
        'approval-1'
      )
    ).toBeFalse()
  })

  test('closes pending approvals when a newer user turn supersedes them', () => {
    const pending = {
      id: 'assistant-pending',
      role: 'assistant' as const,
      parts: [
        {
          type: 'dynamic-tool' as const,
          toolName: 'mcp__mcp-0123456789abcdef__write',
          toolCallId: 'call-pending',
          state: 'approval-requested' as const,
          input: { value: 'draft' },
          approval: { id: 'approval-pending' }
        }
      ]
    }

    const finalized = finalizePendingToolApprovals([pending])
    expect(finalized[0]?.parts[0]).toEqual({
      ...pending.parts[0],
      state: 'output-denied',
      approval: {
        id: 'approval-pending',
        approved: false,
        reason: 'Superseded by a new message.'
      }
    })
    expect(finalizePendingToolApprovals(finalized)).toBe(finalized)
  })
})
