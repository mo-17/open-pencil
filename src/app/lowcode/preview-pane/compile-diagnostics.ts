import type { CompileWarning } from '@open-pencil/compiler'

export type CompileDiagnosticSeverity = 'error' | 'warning'

export interface CompileDiagnostic {
  severity: CompileDiagnosticSeverity
  code: string
  message: string
  nodeId?: string
}

export interface CompileDiagnosticSummary {
  items: CompileDiagnostic[]
  errorCount: number
  warningCount: number
  total: number
}

export function buildCompileDiagnostics(
  warnings: readonly CompileWarning[],
  compileError: string | null
): CompileDiagnostic[] {
  const items: CompileDiagnostic[] = []
  const errorMessage = compileError?.trim()
  if (errorMessage) {
    items.push({ severity: 'error', code: 'preview-compile-error', message: errorMessage })
  }
  for (const warning of warnings) {
    items.push({
      severity: 'warning',
      code: warning.code,
      message: warning.message,
      ...(warning.nodeId ? { nodeId: warning.nodeId } : {})
    })
  }
  return items
}

export function summarizeCompileDiagnostics(
  warnings: readonly CompileWarning[],
  compileError: string | null
): CompileDiagnosticSummary {
  const items = buildCompileDiagnostics(warnings, compileError)
  const errorCount = items.filter((item) => item.severity === 'error').length
  const warningCount = items.length - errorCount
  return { items, errorCount, warningCount, total: items.length }
}
