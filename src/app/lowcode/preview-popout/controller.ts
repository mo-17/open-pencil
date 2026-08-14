import type { CompilerPreviewPopoutControls } from '../preview-pane/popout/controls'
import { parseCompilerPreviewPopoutPayload, type CompilerPreviewPopoutPayload } from './payload'

export interface CompilerPreviewPopoutView {
  loadSource(destination: string): void
  navigate(origin: string, path: string): void
  applyControls(controls: CompilerPreviewPopoutControls): void
  reload(destination: string): void
}

export type CompilerPreviewPopoutUpdate = 'ignored' | 'unchanged' | 'navigated' | 'loaded'

export interface CompilerPreviewPopoutShellController {
  update(value: unknown): CompilerPreviewPopoutUpdate
  reload(): boolean
  snapshot(): CompilerPreviewPopoutPayload | null
}

/**
 * Revision-gated projection from native state into the sandboxed iframe.
 * Same-origin route changes use the compiler bridge; only an origin change
 * replaces the iframe document.
 */
export function createCompilerPreviewPopoutShellController(
  view: CompilerPreviewPopoutView
): CompilerPreviewPopoutShellController {
  let current: CompilerPreviewPopoutPayload | null = null

  function update(value: unknown): CompilerPreviewPopoutUpdate {
    const next = parseCompilerPreviewPopoutPayload(value)
    if (current && next.revision <= current.revision) return 'ignored'

    const nextOrigin = new URL(next.url).origin
    const currentOrigin = current ? new URL(current.url).origin : null
    let result: CompilerPreviewPopoutUpdate
    view.applyControls(next.controls)
    if (currentOrigin !== nextOrigin) {
      view.loadSource(new URL(next.path, next.url).href)
      result = 'loaded'
    } else if (current?.path !== next.path) {
      view.navigate(nextOrigin, next.path)
      result = 'navigated'
    } else {
      result = 'unchanged'
    }
    current = next
    return result
  }

  return {
    update,
    reload() {
      if (!current) return false
      view.reload(new URL(current.path, current.url).href)
      return true
    },
    snapshot: () => current
  }
}
