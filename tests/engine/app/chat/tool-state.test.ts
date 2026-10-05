import { describe, expect, test } from 'bun:test'

import type { ToolCallPart } from '@/app/ai/chat/tool-calls/display'
import { toolState } from '@/app/ai/chat/tool-presentation'
import { classifyToolState, isMCPToolName } from '@/components/chat/tool/state'

describe('classifyToolState', () => {
  test('recognizes MCP tools by their names', () => {
    expect(isMCPToolName('mcp__server__search')).toBe(true)
    expect(isMCPToolName('get_nodes')).toBe(false)
  })

  test('treats omitted and false MCP isError as success', () => {
    expect(
      classifyToolState({
        toolName: 'mcp__server__search',
        state: 'output-available',
        output: { content: [{ type: 'text', text: 'ok' }] }
      })
    ).toBe('done')
    expect(
      classifyToolState({
        toolName: 'mcp__server__search',
        state: 'output-available',
        output: { content: [], isError: false }
      })
    ).toBe('done')
  })

  test('treats true MCP isError as an error', () => {
    expect(
      classifyToolState({
        toolName: 'mcp__server__search',
        state: 'output-available',
        output: { content: [], isError: true }
      })
    ).toBe('error')
  })

  test('does not classify non-MCP content objects as MCP results', () => {
    expect(
      classifyToolState({
        toolName: 'get_nodes',
        state: 'output-available',
        output: { content: [] }
      })
    ).toBe('done')
  })

  test('preserves generic error precedence', () => {
    expect(
      classifyToolState({
        toolName: 'mcp__server__search',
        state: 'output-available',
        output: { content: [], error: 'failed' }
      })
    ).toBe('error')
    expect(
      classifyToolState({
        toolName: 'mcp__server__search',
        state: 'output-error',
        output: { content: [] }
      })
    ).toBe('error')
  })
})

describe('toolState', () => {
  test('classifies a chat part by its tool name, state, and output', () => {
    const part = (fields: Partial<ToolCallPart>) =>
      ({ type: 'tool-diff_apply', toolCallId: 'call', input: {}, ...fields }) as ToolCallPart
    expect(toolState(part({ state: 'input-streaming' }))).toBe('pending')
    expect(toolState(part({ state: 'output-available', output: { applied: 1 } }))).toBe('done')
    expect(
      toolState(part({ state: 'output-available', output: { error: 'Patch does not apply' } }))
    ).toBe('error')
  })
})
