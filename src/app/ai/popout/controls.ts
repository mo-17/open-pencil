import { assertExactBooleanFields } from '@/app/popout/contracts'

export interface AIPopoutControls {
  readonly toolbar: boolean
  readonly focusEditor: boolean
  readonly alwaysOnTop: boolean
  readonly clearChat: boolean
  readonly settings: boolean
}

const CONTROL_KEYS = ['toolbar', 'focusEditor', 'alwaysOnTop', 'clearChat', 'settings'] as const

export const DEFAULT_AI_POPOUT_CONTROLS: AIPopoutControls = Object.freeze({
  toolbar: true,
  focusEditor: true,
  alwaysOnTop: false,
  clearChat: true,
  settings: true
})

/**
 * Validate the complete host-owned presentation contract. Native and UI code
 * must never infer different defaults for an already-open AI window.
 */
export function parseAIPopoutControls(value: unknown): AIPopoutControls {
  assertExactBooleanFields(
    value,
    CONTROL_KEYS,
    'AI popout controls must contain exact boolean fields'
  )
  return Object.freeze({
    toolbar: value.toolbar,
    focusEditor: value.focusEditor,
    alwaysOnTop: value.alwaysOnTop,
    clearChat: value.clearChat,
    settings: value.settings
  })
}

/** Repair untrusted persisted settings without accepting a partial contract. */
export function normalizeAIPopoutControls(value: unknown): AIPopoutControls {
  try {
    return parseAIPopoutControls(value)
  } catch {
    return DEFAULT_AI_POPOUT_CONTROLS
  }
}
