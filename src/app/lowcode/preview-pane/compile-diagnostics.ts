import type { CompileWarning } from '@open-pencil/compiler'

import type { PreviewDiagnostic } from './host/types'

export type CompileDiagnosticSeverity = PreviewDiagnostic['severity']
export type CompileDiagnostic = PreviewDiagnostic

export interface CompileDiagnosticSummary {
  items: CompileDiagnostic[]
  errorCount: number
  warningCount: number
  total: number
}

/** Display copy only: compiler codes, policies and the original diagnostics stay unchanged. */
export function compileDiagnosticMessage(diagnostic: CompileDiagnostic, locale = 'en'): string {
  if (locale === 'zh-CN' && diagnostic.code === 'browser-preview-vr-tour-runtime-unsupported') {
    return 'VR 全景需要在桌面端预览，或导出为 React/Vue 应用后使用。浏览器预览暂不支持全景图片加载和所需样式。'
  }
  if (locale === 'zh-CN' && diagnostic.code === 'browser-preview-file-size-limit') {
    return '浏览器预览不支持超出大小限制或格式无效的生成文件。请检查该文件；较大的素材可使用桌面端预览，或导出 React/Vue 应用后使用。'
  }
  return diagnostic.message
}

export function compileErrorMessage(
  message: string,
  diagnostics: readonly CompileDiagnostic[],
  locale = 'en'
): string {
  const diagnostic = diagnostics.find(
    (item) => item.severity === 'error' && item.message === message
  )
  return diagnostic ? compileDiagnosticMessage(diagnostic, locale) : message
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

export function summarizeStructuredCompileDiagnostics(
  diagnostics: readonly CompileDiagnostic[],
  locale = 'en'
): CompileDiagnosticSummary {
  const items = diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: compileDiagnosticMessage(diagnostic, locale)
  }))
  const errorCount = items.filter((item) => item.severity === 'error').length
  const warningCount = items.length - errorCount
  return { items, errorCount, warningCount, total: items.length }
}
