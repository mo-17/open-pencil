import { describe, expect, test } from 'bun:test'

import {
  hasErrorOutput,
  toolErrorText,
  toolOutputErrorText,
  toolState
} from '@/app/ai/chat/tool-presentation'

describe('chat tool presentation', () => {
  test('treats a successful ACP result envelope with a null error as done', () => {
    const part = {
      state: 'output-available',
      output: {
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id: '0:99', type: 'FRAME', message: 'Created' })
            }
          ],
          structuredContent: null,
          _meta: null
        },
        error: null
      }
    }

    expect(hasErrorOutput(part)).toBe(false)
    expect(toolErrorText(part)).toBeNull()
    expect(toolState(part)).toBe('done')
  })

  test('extracts a business error nested in a completed MCP result', () => {
    const part = {
      state: 'output-available',
      output: {
        result: {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Node "0:404" not found' }) }],
          structuredContent: null,
          _meta: null
        },
        error: null
      }
    }

    expect(hasErrorOutput(part)).toBe(true)
    expect(toolErrorText(part)).toBe('Node "0:404" not found')
    expect(toolState(part)).toBe('error')
  })

  test('treats concrete outer errors and transport failures as errors', () => {
    expect(toolOutputErrorText({ result: null, error: 'RPC timeout (120s)' })).toBe(
      'RPC timeout (120s)'
    )
    expect(toolErrorText({ state: 'output-error', errorText: '' })).toBe('Tool call failed')
    expect(toolState({ state: 'output-error' })).toBe('error')
  })

  test('ignores empty error sentinels and keeps unfinished calls pending', () => {
    for (const error of [null, undefined, false, '', 0]) {
      expect(toolState({ state: 'output-available', output: { result: {}, error } })).toBe('done')
    }
    expect(toolState({ state: 'input-available' })).toBe('pending')
  })
})
