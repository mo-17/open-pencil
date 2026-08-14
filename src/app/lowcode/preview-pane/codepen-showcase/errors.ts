import type { CodePenSidecarDiagnostic } from '@open-pencil/compiler/codepen/sidecar-wire'

export interface CodePenShowcaseErrorDetails {
  message: string
  code?: string
  diagnostics?: readonly CodePenSidecarDiagnostic[]
}

export class CodePenShowcaseSidecarError extends Error {
  readonly code: string
  readonly diagnostics: readonly CodePenSidecarDiagnostic[]

  constructor(
    code: string,
    message: string,
    diagnostics: readonly CodePenSidecarDiagnostic[] = []
  ) {
    super(message)
    this.name = 'CodePenShowcaseSidecarError'
    this.code = code
    this.diagnostics = Object.freeze([...diagnostics])
  }
}

export function codePenShowcaseErrorDetails(error: unknown): CodePenShowcaseErrorDetails {
  if (error instanceof CodePenShowcaseSidecarError) {
    return {
      message: error.message,
      code: error.code,
      ...(error.diagnostics.length > 0 ? { diagnostics: error.diagnostics } : {})
    }
  }
  return { message: error instanceof Error ? error.message : String(error) }
}

export function codePenShowcaseErrorMessage(error: unknown): string {
  return codePenShowcaseErrorDetails(error).message
}
