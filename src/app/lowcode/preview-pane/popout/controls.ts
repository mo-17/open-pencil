import { assertExactBooleanFields } from '@/app/popout/contracts'

export interface CompilerPreviewPopoutControls {
  readonly toolbar: boolean
  readonly reload: boolean
  readonly focusEditor: boolean
  readonly alwaysOnTop: boolean
  readonly diagnostics: boolean
  readonly exportMicrofrontend: boolean
  readonly deploy: boolean
}

const CONTROL_KEYS = [
  'toolbar',
  'reload',
  'focusEditor',
  'alwaysOnTop',
  'diagnostics',
  'exportMicrofrontend',
  'deploy'
] as const

export const DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS: CompilerPreviewPopoutControls =
  Object.freeze({
    toolbar: true,
    reload: true,
    focusEditor: true,
    alwaysOnTop: false,
    diagnostics: true,
    exportMicrofrontend: true,
    deploy: true
  })

/**
 * Validate the complete host-owned presentation contract. Partial objects are
 * deliberately rejected so native and wrapper code never infer different
 * defaults for an already-open window.
 */
export function parseCompilerPreviewPopoutControls(value: unknown): CompilerPreviewPopoutControls {
  assertExactBooleanFields(
    value,
    CONTROL_KEYS,
    'Compiler preview popout controls must contain exact boolean fields'
  )
  return Object.freeze({
    toolbar: value.toolbar,
    reload: value.reload,
    focusEditor: value.focusEditor,
    alwaysOnTop: value.alwaysOnTop,
    diagnostics: value.diagnostics,
    exportMicrofrontend: value.exportMicrofrontend,
    deploy: value.deploy
  })
}

/** Repair untrusted persisted settings without accepting a partial contract. */
export function normalizeCompilerPreviewPopoutControls(
  value: unknown
): CompilerPreviewPopoutControls {
  try {
    return parseCompilerPreviewPopoutControls(value)
  } catch {
    return DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
  }
}
