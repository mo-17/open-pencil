import { describe, expect, test } from 'bun:test'

import type {
  ClientSideConnection,
  SessionConfigOption,
  SessionNotification,
  SessionUpdate,
  SetSessionConfigOptionRequest
} from '@agentclientprotocol/sdk'

import {
  beginACPDiagnostics,
  getACPDiagnostics,
  recordACPConfigOptions,
  recordACPNewSession,
  resetACPDiagnostics
} from '@/app/ai/acp/diagnostics'
import { mapUpdate } from '@/app/ai/acp/map-update'
import {
  buildCrashChunks,
  createSessionUpdateBuffer,
  formatConnectionError,
  requestACPConfigOption
} from '@/app/ai/acp/transport'

const TEXT_ID = 'text-1'

describe('createSessionUpdateBuffer', () => {
  test('replays session-setup notifications after the stream handler is ready', () => {
    const buffer = createSessionUpdateBuffer()
    const received: SessionNotification[] = []
    const startupFailure: SessionNotification = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'mcp_startup.open-pencil',
        title: 'mcp__open-pencil__startup',
        kind: 'other',
        status: 'failed'
      }
    }

    buffer.push(startupFailure)
    expect(received).toEqual([])

    buffer.setHandler((notification) => received.push(notification))
    buffer.flush()
    expect(received).toEqual([startupFailure])

    const laterUpdate: SessionNotification = {
      sessionId: 'session-1',
      update: { sessionUpdate: 'available_commands_update', availableCommands: [] }
    }
    buffer.push(laterUpdate)
    expect(received).toEqual([startupFailure, laterUpdate])
  })

  test('drops late notifications after a prompt handler is detached', () => {
    const buffer = createSessionUpdateBuffer()
    const firstPrompt: SessionNotification[] = []
    const nextPrompt: SessionNotification[] = []
    const lateUpdate: SessionNotification = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'late response from the cancelled prompt' }
      }
    }

    buffer.setHandler((notification) => firstPrompt.push(notification))
    buffer.flush()
    buffer.setHandler(null)
    buffer.push(lateUpdate)

    buffer.setHandler((notification) => nextPrompt.push(notification))
    buffer.flush()
    expect(firstPrompt).toEqual([])
    expect(nextPrompt).toEqual([])
  })
})

describe('requestACPConfigOption', () => {
  test('sends the session config request and returns the complete refreshed option set', async () => {
    let received: SetSessionConfigOptionRequest | undefined
    const refreshedOptions: SessionConfigOption[] = [
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'gpt-5.6-terra',
        options: [{ value: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' }]
      },
      {
        type: 'select',
        id: 'reasoning_effort',
        name: 'Reasoning effort',
        category: 'thought_level',
        currentValue: 'medium',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' }
        ]
      }
    ]
    const connection: Pick<ClientSideConnection, 'setSessionConfigOption'> = {
      async setSessionConfigOption(params) {
        received = params
        return { configOptions: refreshedOptions }
      }
    }

    const result = await requestACPConfigOption(connection, {
      sessionId: 'session-1',
      configId: 'model',
      value: 'gpt-5.6-terra'
    })

    expect(received).toEqual({
      sessionId: 'session-1',
      configId: 'model',
      value: 'gpt-5.6-terra'
    })
    expect(result).toBe(refreshedOptions)
  })
})

describe('ACP config diagnostics', () => {
  test('clears missing categories from complete option snapshots', () => {
    resetACPDiagnostics()
    beginACPDiagnostics('Codex')
    recordACPConfigOptions([
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: 'gpt-5.6-sol',
        options: [{ value: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]
      },
      {
        type: 'select',
        id: 'reasoning_effort',
        name: 'Reasoning effort',
        category: 'thought_level',
        currentValue: 'high',
        options: [{ value: 'high', name: 'High' }]
      }
    ])
    expect(getACPDiagnostics()).toMatchObject({
      modelId: 'gpt-5.6-sol',
      thoughtLevel: 'high'
    })

    recordACPConfigOptions([])
    expect(getACPDiagnostics().modelId).toBeUndefined()
    expect(getACPDiagnostics().thoughtLevel).toBeUndefined()
    resetACPDiagnostics()
  })

  test('uses the legacy new-session model only when config options omit a model', () => {
    resetACPDiagnostics()
    beginACPDiagnostics('Codex')
    recordACPNewSession({
      sessionId: 'session-1',
      configOptions: [
        {
          type: 'select',
          id: 'reasoning_effort',
          name: 'Reasoning effort',
          category: 'thought_level',
          currentValue: 'medium',
          options: [{ value: 'medium', name: 'Medium' }]
        }
      ],
      models: {
        currentModelId: 'legacy-model',
        availableModels: []
      }
    })
    expect(getACPDiagnostics()).toMatchObject({
      modelId: 'legacy-model',
      thoughtLevel: 'medium'
    })

    recordACPNewSession({
      sessionId: 'session-2',
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'config-model',
          options: [{ value: 'config-model', name: 'Config model' }]
        }
      ],
      models: {
        currentModelId: 'stale-legacy-model',
        availableModels: []
      }
    })
    expect(getACPDiagnostics().modelId).toBe('config-model')
    expect(getACPDiagnostics().thoughtLevel).toBeUndefined()
    resetACPDiagnostics()
  })
})

describe('mapUpdate', () => {
  test('agent_message_chunk with non-empty text starts text and emits delta', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.textStarted).toBe(true)
    expect(result.chunks).toEqual([
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'Hello' }
    ])
  })

  test('agent_message_chunk with empty text is skipped', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.textStarted).toBe(false)
    expect(result.chunks).toEqual([])
  })

  test('subsequent agent_message_chunk does not re-emit text-start', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'world' }
    }
    const result = mapUpdate(update, TEXT_ID, true)
    expect(result.textStarted).toBe(true)
    expect(result.chunks).toEqual([{ type: 'text-delta', id: TEXT_ID, delta: 'world' }])
  })

  test('agent_thought_chunk emits reasoning start/delta/end', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thinking...' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toHaveLength(3)
    expect(result.chunks[0].type).toBe('reasoning-start')
    expect(result.chunks[1]).toEqual({
      type: 'reasoning-delta',
      id: `reasoning-${TEXT_ID}`,
      delta: 'thinking...'
    })
    expect(result.chunks[2].type).toBe('reasoning-end')
  })

  test('agent_thought_chunk skips whitespace-only protocol separators', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: '\n\n' }
    }
    expect(mapUpdate(update, TEXT_ID, false).chunks).toEqual([])
  })

  test('tool_call emits tool-input-start', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'create_shape',
      kind: 'edit',
      status: 'pending'
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'tc-1',
        toolName: 'create_shape',
        providerExecuted: true,
        title: 'create_shape'
      }
    ])
  })

  test('tool_call with rawInput emits tool-input-available', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-2',
      title: 'set_fill',
      kind: 'edit',
      status: 'pending',
      rawInput: { id: '1:2', color: '#ff0000' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toHaveLength(2)
    expect(result.chunks[1]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'tc-2',
      toolName: 'set_fill',
      input: { id: '1:2', color: '#ff0000' },
      providerExecuted: true,
      title: 'set_fill'
    })
  })

  test('tool_call with empty title falls back to "unknown"', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-3',
      title: '',
      kind: 'other',
      status: 'pending'
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks[0]).toMatchObject({ toolName: 'unknown' })
  })

  test('tool_call completed emits input and output in the initial update', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-completed',
      title: 'calculate',
      kind: 'other',
      status: 'completed',
      rawInput: { expression: '2 + 2' },
      rawOutput: { result: 4 }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'tc-completed',
        toolName: 'calculate',
        providerExecuted: true,
        title: 'calculate'
      },
      {
        type: 'tool-input-available',
        toolCallId: 'tc-completed',
        toolName: 'calculate',
        input: { expression: '2 + 2' },
        providerExecuted: true,
        title: 'calculate'
      },
      {
        type: 'tool-output-available',
        toolCallId: 'tc-completed',
        output: { result: 4 },
        providerExecuted: true
      }
    ])
  })

  test('tool_call failed emits the error in the initial update', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'mcp_startup.open-pencil',
      title: 'mcp__open-pencil__startup',
      kind: 'other',
      status: 'failed',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'MCP server timed out after 30 seconds' }
        }
      ]
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'mcp_startup.open-pencil',
        toolName: 'mcp__open-pencil__startup',
        providerExecuted: true,
        title: 'mcp__open-pencil__startup'
      },
      {
        type: 'tool-output-error',
        toolCallId: 'mcp_startup.open-pencil',
        errorText: 'MCP server timed out after 30 seconds',
        providerExecuted: true
      }
    ])
  })

  test('tool_call_update completed emits tool-output-available', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'completed',
      rawOutput: { id: '1:5', type: 'RECTANGLE' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'tc-1',
        output: { id: '1:5', type: 'RECTANGLE' },
        providerExecuted: true
      }
    ])
  })

  test('tool_call_update failed emits tool-output-error', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'Node not found' } }]
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([
      {
        type: 'tool-output-error',
        toolCallId: 'tc-1',
        errorText: 'Node not found',
        providerExecuted: true
      }
    ])
  })

  test('tool_call_update failed extracts an MCP error from rawOutput', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-timeout',
      status: 'failed',
      rawOutput: {
        result: {
          content: [{ type: 'text', text: '{"error":"RPC timeout (20s)"}' }],
          error: null
        }
      }
    }
    expect(mapUpdate(update, TEXT_ID, false).chunks).toEqual([
      {
        type: 'tool-output-error',
        toolCallId: 'tc-timeout',
        errorText: 'RPC timeout (20s)',
        providerExecuted: true
      }
    ])
  })

  test('agent_message_chunk with non-text content produces no chunks', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', url: 'https://example.com/img.png' }
    }
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.textStarted).toBe(false)
    expect(result.chunks).toEqual([])
  })

  test('unhandled update type produces no chunks', () => {
    const update = {
      sessionUpdate: 'available_commands_update',
      availableCommands: []
    } as SessionUpdate
    const result = mapUpdate(update, TEXT_ID, false)
    expect(result.chunks).toEqual([])
    expect(result.textStarted).toBe(false)
  })
})

describe('formatConnectionError', () => {
  const claudeAgent = {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude-agent-acp',
    args: [],
    installCommand: 'npm i -g @agentclientprotocol/claude-agent-acp'
  } as const

  test('ECONNREFUSED maps to MCP not running', () => {
    const msg = formatConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:7600'))
    expect(msg).toBe('MCP server is not running. Make sure the editor is open.')
  })

  test('fetch failed maps to MCP not running', () => {
    const msg = formatConnectionError(new Error('fetch failed'))
    expect(msg).toBe('MCP server is not running. Make sure the editor is open.')
  })

  test('timeout maps to timeout message', () => {
    const msg = formatConnectionError(new Error('Request timeout after 30s'))
    expect(msg).toBe('MCP server did not respond in time.')
  })

  test('ENOENT maps to install instructions', () => {
    const msg = formatConnectionError(new Error('spawn claude-agent-acp ENOENT'), claudeAgent)
    expect(msg).toBe(
      '"claude-agent-acp" is not installed. Install it with: npm i -g @agentclientprotocol/claude-agent-acp'
    )
  })

  test('other errors pass through', () => {
    const msg = formatConnectionError(new Error('Something unexpected'))
    expect(msg).toBe('Something unexpected')
  })

  test('non-Error values converted to string', () => {
    const msg = formatConnectionError('raw string error')
    expect(msg).toBe('raw string error')
  })

  test('ACP JSON-RPC error objects preserve their message', () => {
    const msg = formatConnectionError({ code: -32602, message: 'Invalid model' })
    expect(msg).toBe('Invalid model')
  })
})

describe('buildCrashChunks', () => {
  test('destroying=true returns empty chunks, no session null', () => {
    const result = buildCrashChunks(true, TEXT_ID, false)
    expect(result.chunks).toEqual([])
    expect(result.shouldNullSession).toBe(false)
  })

  test('destroying=false with no text emits error + finish', () => {
    const result = buildCrashChunks(false, TEXT_ID, false)
    expect(result.shouldNullSession).toBe(true)
    expect(result.chunks).toEqual([
      { type: 'error', errorText: 'Agent process exited unexpectedly.' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'error' }
    ])
  })

  test('destroying=false with active text emits text-end before error', () => {
    const result = buildCrashChunks(false, TEXT_ID, true)
    expect(result.shouldNullSession).toBe(true)
    expect(result.chunks[0]).toEqual({ type: 'text-end', id: TEXT_ID })
    expect(result.chunks[1]).toEqual({
      type: 'error',
      errorText: 'Agent process exited unexpectedly.'
    })
  })
})
