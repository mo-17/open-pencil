import { beforeEach, describe, expect, test } from 'bun:test'

import {
  beginAcpDiagnostics,
  formatAcpDiagnostics,
  formatAcpRuntimeContext,
  getAcpDiagnostics,
  recordAcpNewSession,
  recordAcpPrompt,
  recordAcpSessionUpdate,
  resetAcpDiagnostics
} from '@/app/ai/acp/diagnostics'
import { formatTokenUsage } from '@/app/ai/debug'

beforeEach(() => resetAcpDiagnostics())

describe('ACP diagnostics', () => {
  test('records the agent, selected model, and thought level', () => {
    beginAcpDiagnostics('Codex')
    recordAcpNewSession({
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

    expect(getAcpDiagnostics()).toMatchObject({
      active: true,
      agentName: 'Codex',
      modelId: 'fallback-model',
      thoughtLevel: 'high'
    })
    expect(formatAcpRuntimeContext(getAcpDiagnostics())).toContain(
      'The current model ID is "fallback-model".'
    )
  })

  test('keeps the latest prompt usage snapshot instead of summing turns', () => {
    beginAcpDiagnostics('Codex')
    recordAcpPrompt({
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
    })
    recordAcpPrompt({
      stopReason: 'end_turn',
      usage: {
        inputTokens: 180,
        outputTokens: 35,
        cachedReadTokens: 40,
        thoughtTokens: 10,
        totalTokens: 225
      }
    })

    expect(getAcpDiagnostics().usage).toEqual({
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
    beginAcpDiagnostics('Codex')
    recordAcpNewSession({
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

    expect(getAcpDiagnostics().modelId).toBe('gpt-5.6-sol')

    recordAcpPrompt({
      stopReason: 'end_turn',
      _meta: {
        quota: {
          model_usage: [{ model: 'gpt-5.6-terra' }]
        }
      }
    })

    expect(getAcpDiagnostics().modelId).toBe('gpt-5.6-terra')
  })

  test('does not replace the selected model with malformed or ambiguous prompt metadata', () => {
    beginAcpDiagnostics('Codex')
    recordAcpNewSession({
      sessionId: 'session-1',
      models: {
        currentModelId: 'gpt-5.6-sol',
        availableModels: []
      }
    })

    recordAcpPrompt({
      stopReason: 'end_turn',
      _meta: {
        quota: {
          model_usage: [{ model: 'gpt-5.6-terra' }, { model: 'gpt-5.4-mini' }, { model: 42 }]
        }
      }
    })

    expect(getAcpDiagnostics().modelId).toBe('gpt-5.6-sol')
  })

  test('records context utilization, cost, and later model changes', () => {
    beginAcpDiagnostics('Codex')
    recordAcpSessionUpdate({
      sessionUpdate: 'usage_update',
      used: 12_000,
      size: 200_000,
      cost: { amount: 0, currency: 'USD' }
    })
    recordAcpSessionUpdate({
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

    expect(getAcpDiagnostics()).toMatchObject({
      modelId: 'gpt-5.6-sol',
      context: {
        used: 12_000,
        size: 200_000,
        cost: { amount: 0, currency: 'USD' }
      }
    })

    expect(formatAcpDiagnostics(getAcpDiagnostics())).toBe(
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
