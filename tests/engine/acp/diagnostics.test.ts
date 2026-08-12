import { beforeEach, describe, expect, test } from 'bun:test'

import {
  beginACPDiagnostics,
  formatACPDiagnostics,
  formatACPRuntimeContext,
  getACPDiagnostics,
  recordACPNewSession,
  recordACPPrompt,
  recordACPSessionUpdate,
  resetACPDiagnostics
} from '@/app/ai/acp/diagnostics'
import { formatTokenUsage } from '@/app/ai/debug'

beforeEach(() => resetACPDiagnostics())

describe('ACP diagnostics', () => {
  test('records the agent, selected model, and thought level', () => {
    beginACPDiagnostics('Codex')
    recordACPNewSession({
      sessionId: 'session-1',
      models: {
        currentModelId: 'gpt-5.6-sol',
        availableModels: []
      },
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'fallback-model[high]',
          options: []
        },
        {
          type: 'select',
          id: 'reasoning',
          name: 'Reasoning',
          category: 'thought_level',
          currentValue: 'high',
          options: []
        }
      ]
    })

    expect(getACPDiagnostics()).toMatchObject({
      active: true,
      agentName: 'Codex',
      modelId: 'fallback-model',
      thoughtLevel: 'high'
    })
    expect(formatACPRuntimeContext(getACPDiagnostics())).toContain(
      'The current model ID is "fallback-model".'
    )
  })

  test('keeps the latest prompt usage snapshot instead of summing turns', () => {
    beginACPDiagnostics('Codex')
    recordACPPrompt({
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
    })
    recordACPPrompt({
      stopReason: 'end_turn',
      usage: {
        inputTokens: 180,
        outputTokens: 35,
        cachedReadTokens: 40,
        thoughtTokens: 10,
        totalTokens: 225
      }
    })

    expect(getACPDiagnostics().usage).toEqual({
      inputTokens: 180,
      outputTokens: 35,
      cachedReadTokens: 40,
      thoughtTokens: 10,
      totalTokens: 225
    })
    expect(formatTokenUsage()).toContain(
      'Latest token snapshot (ACP experimental): in=180 out=35 reasoning=10 total=225'
    )
  })

  test('uses a safely reported prompt model even when usage is absent', () => {
    beginACPDiagnostics('Codex')
    recordACPNewSession({
      sessionId: 'session-1',
      models: {
        currentModelId: 'gpt-5.6-sol[high]',
        availableModels: []
      },
      configOptions: [
        {
          type: 'select',
          id: 'reasoning',
          name: 'Reasoning',
          category: 'thought_level',
          currentValue: 'high',
          options: []
        }
      ]
    })

    expect(getACPDiagnostics().modelId).toBe('gpt-5.6-sol')

    recordACPPrompt({
      stopReason: 'end_turn',
      _meta: {
        quota: {
          model_usage: [{ model: 'gpt-5.6-terra' }]
        }
      }
    })

    expect(getACPDiagnostics().modelId).toBe('gpt-5.6-terra')
  })

  test('does not replace the selected model with malformed or ambiguous prompt metadata', () => {
    beginACPDiagnostics('Codex')
    recordACPNewSession({
      sessionId: 'session-1',
      models: {
        currentModelId: 'gpt-5.6-sol',
        availableModels: []
      }
    })

    recordACPPrompt({
      stopReason: 'end_turn',
      _meta: {
        quota: {
          model_usage: [{ model: 'gpt-5.6-terra' }, { model: 'gpt-5.4-mini' }, { model: 42 }]
        }
      }
    })

    expect(getACPDiagnostics().modelId).toBe('gpt-5.6-sol')
  })

  test('records context utilization, cost, and later model changes', () => {
    beginACPDiagnostics('Codex')
    recordACPSessionUpdate({
      sessionUpdate: 'usage_update',
      used: 12_000,
      size: 200_000,
      cost: { amount: 0, currency: 'USD' }
    })
    recordACPSessionUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'gpt-5.6-sol',
          options: []
        }
      ]
    })

    expect(getACPDiagnostics()).toMatchObject({
      modelId: 'gpt-5.6-sol',
      context: {
        used: 12_000,
        size: 200_000,
        cost: { amount: 0, currency: 'USD' }
      }
    })

    expect(formatACPDiagnostics(getACPDiagnostics())).toBe(
      [
        'Provider: ACP (Codex)',
        'Model: gpt-5.6-sol',
        'Token usage: (agent did not report it)',
        'Context window: 12000/200000 tokens (6.0%)',
        'Session cost reported by agent: 0 USD'
      ].join('\n')
    )
  })
})
