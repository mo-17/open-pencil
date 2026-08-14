import { useLocalStorage } from '@vueuse/core'
import { computed, watch } from 'vue'

import {
  DEFAULT_AI_POPOUT_CONTROLS,
  normalizeAIPopoutControls,
  parseAIPopoutControls,
  type AIPopoutControls
} from '@/app/ai/popout/controls'
import { readLocalStorageText } from '@/app/cache'

export const AI_POPOUT_CONTROLS_STORAGE_KEY = 'open-pencil:ai-popout-controls:v2'
export const LEGACY_AI_POPOUT_CONTROLS_STORAGE_KEY = 'open-pencil:ai-popout-controls:v1'

interface LegacyAIPopoutControls {
  readonly toolbar: boolean
  readonly focusEditor: boolean
  readonly alwaysOnTop: boolean
}

function isLegacyAIPopoutControls(value: unknown): value is LegacyAIPopoutControls {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  if (keys.join('\0') !== ['alwaysOnTop', 'focusEditor', 'toolbar'].join('\0')) return false
  return keys.every((key) => typeof Reflect.get(value, key) === 'boolean')
}

export function migrateLegacyAIPopoutControls(value: unknown): AIPopoutControls | null {
  if (!isLegacyAIPopoutControls(value)) return null
  return Object.freeze({
    toolbar: value.toolbar,
    focusEditor: value.focusEditor,
    alwaysOnTop: value.alwaysOnTop,
    clearChat: DEFAULT_AI_POPOUT_CONTROLS.clearChat,
    settings: DEFAULT_AI_POPOUT_CONTROLS.settings
  })
}

function readLegacyAIPopoutControls(): AIPopoutControls | null {
  const text = readLocalStorageText(LEGACY_AI_POPOUT_CONTROLS_STORAGE_KEY)
  if (!text) return null
  try {
    return migrateLegacyAIPopoutControls(JSON.parse(text))
  } catch {
    return null
  }
}

export function repairStoredAIPopoutControls(
  value: unknown,
  persist: (controls: AIPopoutControls) => void
): AIPopoutControls {
  try {
    return parseAIPopoutControls(value)
  } catch {
    const normalized = migrateLegacyAIPopoutControls(value) ?? normalizeAIPopoutControls(value)
    persist(normalized)
    return normalized
  }
}

const storedControls = useLocalStorage<unknown>(
  AI_POPOUT_CONTROLS_STORAGE_KEY,
  readLegacyAIPopoutControls() ?? DEFAULT_AI_POPOUT_CONTROLS
)

watch(
  storedControls,
  (value) => {
    repairStoredAIPopoutControls(value, (controls) => {
      storedControls.value = controls
    })
  },
  { immediate: true }
)

export const aiPopoutControls = computed<AIPopoutControls>({
  get: () => normalizeAIPopoutControls(storedControls.value),
  set: (controls) => {
    storedControls.value = normalizeAIPopoutControls(controls)
  }
})

export function resetAIPopoutControls(): void {
  aiPopoutControls.value = DEFAULT_AI_POPOUT_CONTROLS
}
