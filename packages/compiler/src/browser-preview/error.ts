import type { BrowserPreviewDiagnostic } from './types'

export class BrowserPreviewBuildError extends Error {
  readonly diagnostics: readonly BrowserPreviewDiagnostic[]

  constructor(diagnostic: BrowserPreviewDiagnostic | readonly BrowserPreviewDiagnostic[]) {
    const diagnostics = Array.isArray(diagnostic) ? diagnostic : [diagnostic]
    super(diagnostics[0]?.message ?? 'Browser preview build failed')
    this.name = 'BrowserPreviewBuildError'
    this.diagnostics = diagnostics
  }
}

export function failBrowserPreview(code: string, message: string, path?: string): never {
  throw new BrowserPreviewBuildError({
    code,
    severity: 'error',
    message,
    ...(path === undefined ? {} : { path })
  })
}
