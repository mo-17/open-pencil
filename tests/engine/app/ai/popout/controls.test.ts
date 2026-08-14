import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_AI_POPOUT_CONTROLS,
  normalizeAIPopoutControls,
  parseAIPopoutControls
} from '@/app/ai/popout/controls'

const completeControls = {
  toolbar: false,
  focusEditor: true,
  alwaysOnTop: true,
  clearChat: false,
  settings: true
}

describe('AI popout controls', () => {
  test('accepts and freezes only the exact complete boolean contract', () => {
    const parsed = parseAIPopoutControls(completeControls)

    expect(parsed).toEqual(completeControls)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  test('rejects partial, extended, and non-boolean control objects', () => {
    for (const value of [
      null,
      [],
      {},
      { ...completeControls, focusEditor: 'yes' },
      { ...completeControls, extra: true },
      { toolbar: true, focusEditor: true }
    ]) {
      expect(() => parseAIPopoutControls(value)).toThrow()
    }
  })

  test('normalizes invalid persisted values to the complete frozen defaults', () => {
    expect(normalizeAIPopoutControls({ toolbar: false })).toBe(DEFAULT_AI_POPOUT_CONTROLS)
    expect(DEFAULT_AI_POPOUT_CONTROLS).toEqual({
      toolbar: true,
      focusEditor: true,
      alwaysOnTop: false,
      clearChat: true,
      settings: true
    })
    expect(Object.isFrozen(DEFAULT_AI_POPOUT_CONTROLS)).toBe(true)
    expect(normalizeAIPopoutControls(completeControls)).toEqual(completeControls)
  })
})
