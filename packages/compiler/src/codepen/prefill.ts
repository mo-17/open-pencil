import { CodePenShowcaseError } from './error'
import { auditCodePenOptionSecrets, auditCodePenPrefillSecrets } from './security'
import {
  CODEPEN_PREFILL_ENDPOINT,
  CODEPEN_SHOWCASE_LIMITS,
  type CodePenPrefillData,
  type CodePenShowcaseDiagnostic,
  type CodePenShowcaseOptions,
  type CodePenShowcaseResult
} from './types'

const textEncoder = new TextEncoder()

export function codePenByteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

function truncateUTF8(value: string, maximumBytes: number): string {
  if (codePenByteLength(value) <= maximumBytes) return value
  let output = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = codePenByteLength(character)
    if (bytes + characterBytes > maximumBytes) break
    output += character
    bytes += characterBytes
  }
  return output
}

function outputLimits(
  html: string,
  css: string,
  js: string,
  payload: string
): CodePenShowcaseDiagnostic[] {
  const diagnostics: CodePenShowcaseDiagnostic[] = []
  for (const [path, content] of [
    ['codepen.html', html],
    ['codepen.css', css],
    ['codepen.js', js]
  ] as const) {
    const bytes = codePenByteLength(content)
    if (bytes > CODEPEN_SHOWCASE_LIMITS.maxTextFileBytes) {
      diagnostics.push({
        code: 'codepen-text-file-limit',
        severity: 'error',
        path,
        message: `CodePen export blocked: ${path} is ${bytes} bytes; the documented per-text-file limit is ${CODEPEN_SHOWCASE_LIMITS.maxTextFileBytes}.`
      })
    }
  }
  const payloadBytes = codePenByteLength(payload)
  if (payloadBytes > CODEPEN_SHOWCASE_LIMITS.maxPrefillPayloadBytes) {
    diagnostics.push({
      code: 'codepen-prefill-payload-limit',
      severity: 'error',
      message: `CodePen export blocked: Prefill payload is ${payloadBytes} bytes; maximum is ${CODEPEN_SHOWCASE_LIMITS.maxPrefillPayloadBytes}.`
    })
  }
  return diagnostics
}

function cleanOptions(
  options: CodePenShowcaseOptions
): Omit<CodePenPrefillData, 'html' | 'css' | 'js'> {
  const tags = options.tags
    ?.map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => truncateUTF8(tag, 64))
    .slice(0, 5)
  const title = options.title?.trim()
  const description = options.description?.trim()
  return {
    ...(title ? { title: truncateUTF8(title, 256) } : {}),
    ...(description ? { description: truncateUTF8(description, 4_096) } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(options.private === undefined ? {} : { private: options.private }),
    ...(options.layout ? { layout: options.layout } : {}),
    html_pre_processor: 'none',
    css_pre_processor: 'none',
    js_pre_processor: 'none'
  }
}

export function finalizeCodePenShowcase(
  html: string,
  css: string,
  js: string,
  options: CodePenShowcaseOptions,
  initialDiagnostics: readonly CodePenShowcaseDiagnostic[]
): CodePenShowcaseResult {
  const data: CodePenPrefillData = { ...cleanOptions(options), html, css, js }
  const payload = JSON.stringify(data)
  const diagnostics = [
    ...initialDiagnostics,
    ...auditCodePenOptionSecrets(options),
    ...auditCodePenPrefillSecrets(payload),
    ...outputLimits(html, css, js, payload)
  ]
  const compatible = !diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  if (!compatible) throw new CodePenShowcaseError(diagnostics)
  return {
    html,
    css,
    js,
    data,
    payload,
    request: {
      endpoint: CODEPEN_PREFILL_ENDPOINT,
      method: 'POST',
      target: '_blank',
      fieldName: 'data',
      fieldValue: payload
    },
    diagnostics,
    compatible
  }
}
