import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS,
  normalizeCompilerPreviewPopoutControls,
  parseCompilerPreviewPopoutControls
} from '@/app/lowcode/preview-pane/popout/controls'
import { parseCompilerPreviewPopoutIntent } from '@/app/lowcode/preview-pane/popout/intent'

const completeControls = {
  toolbar: false,
  reload: false,
  focusEditor: true,
  alwaysOnTop: true,
  diagnostics: false,
  exportMicrofrontend: true,
  deploy: false
}

describe('compiler preview popout controls', () => {
  test('accepts and freezes only the exact complete boolean contract', () => {
    const parsed = parseCompilerPreviewPopoutControls(completeControls)

    expect(parsed).toEqual(completeControls)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  test('rejects partial, extended, and non-boolean control objects', () => {
    for (const value of [
      null,
      [],
      {},
      { ...completeControls, reload: 'yes' },
      { ...completeControls, extra: true },
      { toolbar: true, reload: true, focusEditor: true }
    ]) {
      expect(() => parseCompilerPreviewPopoutControls(value)).toThrow()
    }
  })

  test('normalizes invalid persisted values to the complete frozen defaults', () => {
    expect(normalizeCompilerPreviewPopoutControls({ toolbar: false })).toBe(
      DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
    )
    expect(DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS).toEqual({
      toolbar: true,
      reload: true,
      focusEditor: true,
      alwaysOnTop: false,
      diagnostics: true,
      exportMicrofrontend: true,
      deploy: true
    })
    expect(Object.isFrozen(DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS)).toBe(true)
    expect(normalizeCompilerPreviewPopoutControls(completeControls)).toEqual(completeControls)
  })
})

describe('compiler preview popout intents', () => {
  test.each(['diagnostics', 'exportMicrofrontend', 'deploy'] as const)(
    'accepts and freezes the %s intent',
    (type) => {
      const intent = parseCompilerPreviewPopoutIntent({ type })
      expect(intent).toEqual({ type })
      expect(Object.isFrozen(intent)).toBe(true)
    }
  )

  test.each([null, {}, { type: 'reload' }, { type: 'diagnostics', extra: true }, { type: 1 }])(
    'rejects invalid intent %#',
    (value) => {
      expect(() => parseCompilerPreviewPopoutIntent(value)).toThrow()
    }
  )
})
