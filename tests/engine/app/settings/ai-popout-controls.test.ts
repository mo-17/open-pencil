import { describe, expect, test } from 'bun:test'

import { DEFAULT_AI_POPOUT_CONTROLS, type AIPopoutControls } from '@/app/ai/popout/controls'
import {
  AI_POPOUT_CONTROLS_STORAGE_KEY,
  LEGACY_AI_POPOUT_CONTROLS_STORAGE_KEY,
  aiPopoutControls,
  migrateLegacyAIPopoutControls,
  repairStoredAIPopoutControls,
  resetAIPopoutControls
} from '@/app/settings/ai-popout-controls'

const CUSTOM_CONTROLS: AIPopoutControls = Object.freeze({
  toolbar: true,
  focusEditor: false,
  alwaysOnTop: true,
  clearChat: false,
  settings: false
})

describe('AI popout control settings', () => {
  test('uses a versioned, feature-specific storage key', () => {
    expect(AI_POPOUT_CONTROLS_STORAGE_KEY).toBe('open-pencil:ai-popout-controls:v2')
    expect(LEGACY_AI_POPOUT_CONTROLS_STORAGE_KEY).toBe('open-pencil:ai-popout-controls:v1')
  })

  test('migrates the exact v1 record while preserving every existing choice', () => {
    const legacy = { toolbar: false, focusEditor: false, alwaysOnTop: true }
    expect(migrateLegacyAIPopoutControls(legacy)).toEqual({
      ...legacy,
      clearChat: true,
      settings: true
    })
    expect(migrateLegacyAIPopoutControls({ ...legacy, extra: true })).toBeNull()

    const writes: AIPopoutControls[] = []
    expect(repairStoredAIPopoutControls(legacy, (controls) => writes.push(controls))).toEqual({
      ...legacy,
      clearChat: true,
      settings: true
    })
    expect(writes).toEqual([{ ...legacy, clearChat: true, settings: true }])
  })

  test('preserves a complete canonical record without rewriting it', () => {
    const writes: AIPopoutControls[] = []

    expect(
      repairStoredAIPopoutControls(CUSTOM_CONTROLS, (controls) => writes.push(controls))
    ).toEqual(CUSTOM_CONTROLS)
    expect(writes).toEqual([])
  })

  test.each([
    undefined,
    null,
    {},
    { toolbar: false },
    { ...CUSTOM_CONTROLS, extra: true },
    { ...CUSTOM_CONTROLS, focusEditor: 'yes' }
  ])('repairs invalid persisted value %# to the complete defaults', (value) => {
    const writes: AIPopoutControls[] = []

    expect(repairStoredAIPopoutControls(value, (controls) => writes.push(controls))).toEqual(
      DEFAULT_AI_POPOUT_CONTROLS
    )
    expect(writes).toEqual([DEFAULT_AI_POPOUT_CONTROLS])
  })

  test('updates a complete preference record and restores every default', () => {
    aiPopoutControls.value = CUSTOM_CONTROLS
    expect(aiPopoutControls.value).toEqual(CUSTOM_CONTROLS)

    resetAIPopoutControls()
    expect(aiPopoutControls.value).toEqual(DEFAULT_AI_POPOUT_CONTROLS)
  })
})
