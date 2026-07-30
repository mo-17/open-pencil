import { describe, expect, test } from 'bun:test'

import type { SessionUpdate } from '@agentclientprotocol/sdk'

import { createACPUpdateMapper } from '@/app/ai/acp/map-update'
import { INTERRUPTED_TOOL_ERROR } from '@/app/ai/chat/interruption'

function message(text: string, phase: 'commentary' | 'final_answer'): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text },
    _meta: { codex: { phase } }
  } as SessionUpdate
}

describe('createACPUpdateMapper', () => {
  test('finalizes only unfinished visible tools when a prompt is interrupted', () => {
    const mapper = createACPUpdateMapper('cancel')
    expect(
      mapper.map({
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-running',
        title: 'Render',
        status: 'in_progress',
        rawInput: { jsx: '<Frame />' }
      })
    ).toContainEqual(
      expect.objectContaining({ type: 'tool-input-available', toolCallId: 'tc-running' })
    )

    expect(mapper.interrupt(INTERRUPTED_TOOL_ERROR)).toContainEqual({
      type: 'tool-output-error',
      toolCallId: 'tc-running',
      errorText: INTERRUPTED_TOOL_ERROR,
      providerExecuted: true
    })
    expect(mapper.interrupt(INTERRUPTED_TOOL_ERROR)).toEqual([])
  })

  test('merges adjacent reasoning deltas into one bounded reasoning part', () => {
    const mapper = createACPUpdateMapper('turn-reasoning')
    const thought = (text: string): SessionUpdate => ({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text }
    })

    const chunks = [
      ...mapper.map(thought('first ')),
      ...mapper.map(thought('second ')),
      ...mapper.map(thought('third')),
      ...mapper.finish()
    ]

    expect(chunks).toEqual([
      { type: 'reasoning-start', id: 'turn-reasoning-reasoning-0' },
      {
        type: 'reasoning-delta',
        id: 'turn-reasoning-reasoning-0',
        delta: 'first '
      },
      {
        type: 'reasoning-delta',
        id: 'turn-reasoning-reasoning-0',
        delta: 'second '
      },
      {
        type: 'reasoning-delta',
        id: 'turn-reasoning-reasoning-0',
        delta: 'third'
      },
      { type: 'reasoning-end', id: 'turn-reasoning-reasoning-0' }
    ])
  })

  test('preserves commentary, tool, and final-answer chronology with separate text IDs', () => {
    const mapper = createACPUpdateMapper('turn-1')
    const chunks = [
      ...mapper.map(message('Before tool', 'commentary')),
      ...mapper.map({
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'mcp.open-pencil.describe',
        kind: 'read',
        status: 'in_progress',
        rawInput: { id: '0:1' }
      }),
      ...mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-1',
        status: 'completed',
        rawOutput: { id: '0:1' }
      }),
      ...mapper.map(message('After tool', 'commentary')),
      ...mapper.map(message('Final answer', 'final_answer')),
      ...mapper.finish()
    ]

    const textChunks = chunks.filter((chunk) => chunk.type.startsWith('text-'))
    expect(textChunks).toEqual([
      { type: 'text-start', id: 'turn-1-text-0' },
      { type: 'text-delta', id: 'turn-1-text-0', delta: 'Before tool' },
      { type: 'text-end', id: 'turn-1-text-0' },
      { type: 'text-start', id: 'turn-1-text-1' },
      { type: 'text-delta', id: 'turn-1-text-1', delta: 'After tool' },
      { type: 'text-end', id: 'turn-1-text-1' },
      { type: 'text-start', id: 'turn-1-text-2' },
      { type: 'text-delta', id: 'turn-1-text-2', delta: 'Final answer' },
      { type: 'text-end', id: 'turn-1-text-2' }
    ])
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-end',
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'text-start',
      'text-delta',
      'text-end',
      'text-start',
      'text-delta',
      'text-end'
    ])
  })

  test('filters Guardian Review calls and their terminal updates', () => {
    const mapper = createACPUpdateMapper('turn-guardian')
    expect(
      mapper.map({
        sessionUpdate: 'tool_call',
        toolCallId: 'guardian_assessment:review-1',
        title: 'Guardian Review',
        kind: 'think',
        status: 'in_progress'
      })
    ).toEqual([])
    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'guardian_assessment:review-1',
        status: 'completed',
        rawOutput: { approved: true }
      })
    ).toEqual([])
  })

  test('accumulates raw input and output delivered before terminal status', () => {
    const mapper = createACPUpdateMapper('turn-split')
    const chunks = [
      ...mapper.map({
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-split',
        title: 'mcp.open-pencil.render',
        kind: 'edit',
        status: 'in_progress'
      }),
      ...mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-split',
        rawInput: { jsx: '<Frame />' },
        rawOutput: { id: '0:2' }
      }),
      ...mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-split',
        status: 'completed'
      })
    ]

    expect(chunks).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'tc-split',
        toolName: 'mcp.open-pencil.render',
        providerExecuted: true,
        title: 'mcp.open-pencil.render'
      },
      {
        type: 'tool-input-available',
        toolCallId: 'tc-split',
        toolName: 'mcp.open-pencil.render',
        input: { jsx: '<Frame />' },
        providerExecuted: true,
        title: 'mcp.open-pencil.render'
      },
      {
        type: 'tool-output-available',
        toolCallId: 'tc-split',
        output: { id: '0:2' },
        providerExecuted: true
      }
    ])
  })

  test('re-emits a terminal result when output arrives after completed status', () => {
    const mapper = createACPUpdateMapper('turn-status-first')
    mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-status-first',
      title: 'mcp.open-pencil.render',
      kind: 'edit',
      status: 'in_progress'
    })

    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-status-first',
        status: 'completed'
      })
    ).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'tc-status-first',
        output: undefined,
        providerExecuted: true
      }
    ])
    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-status-first',
        rawOutput: { id: '0:9' }
      })
    ).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'tc-status-first',
        output: { id: '0:9' },
        providerExecuted: true
      }
    ])
  })

  test('replaces a generic terminal failure when a concrete error arrives later', () => {
    const mapper = createACPUpdateMapper('turn-error-late')
    mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-error-late',
      title: 'mcp.open-pencil.render',
      kind: 'edit',
      status: 'in_progress'
    })

    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-error-late',
        status: 'failed'
      })
    ).toEqual([
      {
        type: 'tool-output-error',
        toolCallId: 'tc-error-late',
        errorText: 'Tool call failed',
        providerExecuted: true
      }
    ])
    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-error-late',
        rawOutput: {
          result: {
            content: [{ type: 'text', text: '{"error":"RPC timeout (120s)"}' }]
          }
        }
      })
    ).toEqual([
      {
        type: 'tool-output-error',
        toolCallId: 'tc-error-late',
        errorText: 'RPC timeout (120s)',
        providerExecuted: true
      }
    ])
  })

  test('closes intervening text before a late terminal tool update', () => {
    const mapper = createACPUpdateMapper('turn-interleaved')
    mapper.map({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-interleaved',
      title: 'mcp.open-pencil.describe',
      kind: 'read',
      status: 'in_progress'
    })
    mapper.map(message('Waiting for the result', 'commentary'))

    expect(
      mapper.map({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-interleaved',
        status: 'completed',
        rawOutput: { id: '0:10' }
      })
    ).toEqual([
      { type: 'text-end', id: 'turn-interleaved-text-0' },
      {
        type: 'tool-output-available',
        toolCallId: 'tc-interleaved',
        output: { id: '0:10' },
        providerExecuted: true
      }
    ])
  })
})
