import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS,
  type CompilerPreviewPopoutControls
} from '@/app/lowcode/preview-pane/popout/controls'
import {
  COMPILER_PREVIEW_POPOUT_CONTROLS_STORAGE_KEY,
  compilerPreviewPopoutControls,
  repairStoredCompilerPreviewPopoutControls,
  resetCompilerPreviewPopoutControls
} from '@/app/settings/compiler-preview-popout-controls'

const CUSTOM_CONTROLS: CompilerPreviewPopoutControls = Object.freeze({
  toolbar: true,
  reload: false,
  focusEditor: false,
  alwaysOnTop: true,
  diagnostics: false,
  exportMicrofrontend: true,
  deploy: false
})

describe('compiler preview popout control settings', () => {
  test('uses a versioned, feature-specific storage key', () => {
    expect(COMPILER_PREVIEW_POPOUT_CONTROLS_STORAGE_KEY).toBe(
      'open-pencil:compiler-preview-popout-controls:v1'
    )
  })

  test('preserves a complete canonical record without rewriting it', () => {
    const writes: CompilerPreviewPopoutControls[] = []

    expect(
      repairStoredCompilerPreviewPopoutControls(CUSTOM_CONTROLS, (controls) =>
        writes.push(controls)
      )
    ).toEqual(CUSTOM_CONTROLS)
    expect(writes).toEqual([])
  })

  test.each([
    undefined,
    null,
    {},
    { toolbar: false },
    { ...CUSTOM_CONTROLS, extra: true },
    { ...CUSTOM_CONTROLS, reload: 'yes' }
  ])('repairs invalid persisted value %# to the complete defaults', (value) => {
    const writes: CompilerPreviewPopoutControls[] = []

    expect(
      repairStoredCompilerPreviewPopoutControls(value, (controls) => writes.push(controls))
    ).toEqual(DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS)
    expect(writes).toEqual([DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS])
  })

  test('migrates the exact legacy control record without losing preferences', () => {
    const writes: CompilerPreviewPopoutControls[] = []
    const legacy = { toolbar: false, reload: false, focusEditor: true, alwaysOnTop: true }

    expect(
      repairStoredCompilerPreviewPopoutControls(legacy, (controls) => writes.push(controls))
    ).toEqual({
      ...legacy,
      diagnostics: true,
      exportMicrofrontend: true,
      deploy: true
    })
    expect(writes).toHaveLength(1)
  })

  test('updates a complete preference record and restores every default', () => {
    compilerPreviewPopoutControls.value = CUSTOM_CONTROLS
    expect(compilerPreviewPopoutControls.value).toEqual(CUSTOM_CONTROLS)

    resetCompilerPreviewPopoutControls()
    expect(compilerPreviewPopoutControls.value).toEqual(DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS)
  })
})
