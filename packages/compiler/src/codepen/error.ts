import type { CodePenShowcaseDiagnostic } from './types'

function codePenErrorMessage(diagnostics: readonly CodePenShowcaseDiagnostic[]): string {
  const primary = diagnostics.find((diagnostic) => diagnostic.severity === 'error')
  if (primary) return primary.message
  return diagnostics.length > 0 ? diagnostics[0].message : 'CodePen showcase export failed'
}

export class CodePenShowcaseError extends Error {
  readonly diagnostics: readonly CodePenShowcaseDiagnostic[]

  constructor(diagnostics: readonly CodePenShowcaseDiagnostic[]) {
    super(codePenErrorMessage(diagnostics))
    this.name = 'CodePenShowcaseError'
    this.diagnostics = [...diagnostics]
  }
}
