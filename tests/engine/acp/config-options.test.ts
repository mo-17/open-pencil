import { describe, expect, test } from 'bun:test'

import type { SessionConfigOption } from '@agentclientprotocol/sdk'

import {
  findACPConfigOption,
  groupACPConfigOptions,
  selectedACPConfigLabel
} from '@/app/ai/acp/config-options'

const modelOption: SessionConfigOption = {
  type: 'select',
  id: 'model',
  name: 'Model',
  category: 'model',
  currentValue: 'gpt-5.6-sol',
  options: [
    { value: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Detailed and polished' },
    { value: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', description: 'Fast everyday work' }
  ]
}

describe('ACP config options', () => {
  test('finds model and reasoning selectors by category', () => {
    const reasoningOption: SessionConfigOption = {
      type: 'select',
      id: 'custom-effort-id',
      name: 'Reasoning',
      category: 'thought_level',
      currentValue: 'high',
      options: [{ value: 'high', name: 'High' }]
    }

    expect(findACPConfigOption([modelOption, reasoningOption], 'model')).toBe(modelOption)
    expect(findACPConfigOption([modelOption, reasoningOption], 'thought_level')).toBe(
      reasoningOption
    )
  })

  test('falls back to Codex config IDs when an agent omits categories', () => {
    const reasoningOption: SessionConfigOption = {
      type: 'select',
      id: 'reasoning_effort',
      name: 'Reasoning effort',
      currentValue: 'medium',
      options: [{ value: 'medium', name: 'Medium' }]
    }

    expect(findACPConfigOption([reasoningOption], 'thought_level')).toBe(reasoningOption)
  })

  test('normalizes flat and grouped selectors for the shared UI control', () => {
    expect(groupACPConfigOptions(modelOption)).toEqual([
      {
        items: [
          {
            value: 'gpt-5.6-sol',
            label: 'GPT-5.6 Sol',
            description: 'Detailed and polished'
          },
          {
            value: 'gpt-5.6-terra',
            label: 'GPT-5.6 Terra',
            description: 'Fast everyday work'
          }
        ]
      }
    ])

    const grouped: SessionConfigOption = {
      type: 'select',
      id: 'model',
      name: 'Model',
      category: 'model',
      currentValue: 'gpt-5.6-sol',
      options: [
        {
          group: 'recommended',
          name: 'Recommended',
          options: [{ value: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }]
        },
        {
          group: 'other',
          name: 'Other',
          options: [{ value: 'gpt-5.4-mini', name: 'GPT-5.4 mini' }]
        }
      ]
    }

    expect(groupACPConfigOptions(grouped)).toEqual([
      {
        label: 'Recommended',
        items: [{ value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }]
      },
      {
        label: 'Other',
        items: [{ value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' }]
      }
    ])
    expect(selectedACPConfigLabel(grouped)).toBe('GPT-5.6 Sol')
  })

  test('falls back to the raw current value when it is not in the advertised options', () => {
    expect(selectedACPConfigLabel({ ...modelOption, currentValue: 'custom-model' })).toBe(
      'custom-model'
    )
  })
})
