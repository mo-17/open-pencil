import { useLocalStorage } from '@vueuse/core'
import { computed, watch } from 'vue'

import {
  DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS,
  normalizeCompilerPreviewPopoutControls,
  parseCompilerPreviewPopoutControls,
  type CompilerPreviewPopoutControls
} from '@/app/lowcode/preview-pane/popout/controls'

export const COMPILER_PREVIEW_POPOUT_CONTROLS_STORAGE_KEY =
  'open-pencil:compiler-preview-popout-controls:v1'

export function repairStoredCompilerPreviewPopoutControls(
  value: unknown,
  persist: (controls: CompilerPreviewPopoutControls) => void
): CompilerPreviewPopoutControls {
  try {
    return parseCompilerPreviewPopoutControls(value)
  } catch {
    const normalized = migrateCompilerPreviewPopoutControls(value)
    persist(normalized)
    return normalized
  }
}

function migrateCompilerPreviewPopoutControls(value: unknown): CompilerPreviewPopoutControls {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
  }
  const keys = Reflect.ownKeys(value)
  const legacyKeys = ['toolbar', 'reload', 'focusEditor', 'alwaysOnTop'] as const
  if (
    keys.length !== legacyKeys.length ||
    keys.some((key) => typeof key !== 'string' || !legacyKeys.includes(key as never)) ||
    legacyKeys.some((key) => typeof Reflect.get(value, key) !== 'boolean')
  ) {
    return DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
  }
  return parseCompilerPreviewPopoutControls({
    toolbar: Reflect.get(value, 'toolbar'),
    reload: Reflect.get(value, 'reload'),
    focusEditor: Reflect.get(value, 'focusEditor'),
    alwaysOnTop: Reflect.get(value, 'alwaysOnTop'),
    diagnostics: DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS.diagnostics,
    exportMicrofrontend: DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS.exportMicrofrontend,
    deploy: DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS.deploy
  })
}

const storedControls = useLocalStorage<unknown>(
  COMPILER_PREVIEW_POPOUT_CONTROLS_STORAGE_KEY,
  DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
)

watch(
  storedControls,
  (value) => {
    repairStoredCompilerPreviewPopoutControls(value, (controls) => {
      storedControls.value = controls
    })
  },
  { immediate: true }
)

export const compilerPreviewPopoutControls = computed<CompilerPreviewPopoutControls>({
  get: () => normalizeCompilerPreviewPopoutControls(storedControls.value),
  set: (controls) => {
    storedControls.value = normalizeCompilerPreviewPopoutControls(controls)
  }
})

export function resetCompilerPreviewPopoutControls(): void {
  compilerPreviewPopoutControls.value = DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
}
