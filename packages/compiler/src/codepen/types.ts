import type { PreviewFiles } from '../vfs'

export const CODEPEN_PREFILL_ENDPOINT = 'https://codepen.io/cpe/pen/define/' as const

export const CODEPEN_SHOWCASE_LIMITS = Object.freeze({
  /** CodePen's documented per-text-file limit. */
  maxTextFileBytes: 1_000_000,
  /** Keep the POST payload bounded before a browser form is constructed. */
  maxPrefillPayloadBytes: 3_100_000,
  maxSourceFiles: 10_000,
  maxSourceBytes: 64 * 1024 * 1024
})

export type CodePenDiagnosticSeverity = 'error' | 'warning'

export interface CodePenShowcaseDiagnostic {
  code: string
  severity: CodePenDiagnosticSeverity
  message: string
  path?: string
}

export interface CodePenShowcaseSource {
  files: PreviewFiles
  target: 'react' | 'vue'
}

export interface CodePenShowcaseOptions {
  title?: string
  description?: string
  tags?: string[]
  private?: boolean
  layout?: 'left' | 'top' | 'right'
}

export interface CodePenPrefillData {
  title?: string
  description?: string
  tags?: string[]
  private?: boolean
  layout?: 'left' | 'top' | 'right'
  html: string
  html_pre_processor: 'none'
  css: string
  css_pre_processor: 'none'
  js: string
  js_pre_processor: 'none'
}

export interface CodePenPrefillRequest {
  endpoint: typeof CODEPEN_PREFILL_ENDPOINT
  method: 'POST'
  target: '_blank'
  fieldName: 'data'
  fieldValue: string
}

export interface CodePenShowcaseResult {
  html: string
  css: string
  js: string
  data: CodePenPrefillData
  payload: string
  request: CodePenPrefillRequest
  diagnostics: CodePenShowcaseDiagnostic[]
  compatible: boolean
}
