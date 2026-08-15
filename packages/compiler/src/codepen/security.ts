import { findCodePenSecretKinds } from '@open-pencil/lowcode'

import type { PreviewFiles } from '../vfs'
import type { CodePenShowcaseDiagnostic, CodePenShowcaseOptions } from './types'

const binaryDecoder = new TextDecoder('latin1')

function comparePath(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function redactMessage(path: string, kind: string): CodePenShowcaseDiagnostic {
  return {
    code: 'codepen-secret-detected',
    severity: 'error',
    path,
    message: `CodePen export blocked: ${kind} detected in ${path}. Remove it or use a server-side environment variable.`
  }
}

function sourceSecrets(path: string, source: string): CodePenShowcaseDiagnostic[] {
  return findCodePenSecretKinds(source).map((kind) => redactMessage(path, kind))
}

export function auditCodePenSourceSecrets(files: PreviewFiles): CodePenShowcaseDiagnostic[] {
  const diagnostics: CodePenShowcaseDiagnostic[] = []
  const entries = [...files].sort(([left], [right]) => comparePath(left, right))
  for (const [path, content] of entries) {
    diagnostics.push(
      ...sourceSecrets(path, typeof content === 'string' ? content : binaryDecoder.decode(content))
    )
  }
  return diagnostics
}

export function auditCodePenOptionSecrets(
  options: CodePenShowcaseOptions
): CodePenShowcaseDiagnostic[] {
  return [
    ...(options.title === undefined ? [] : sourceSecrets('options.title', options.title)),
    ...(options.description === undefined
      ? []
      : sourceSecrets('options.description', options.description)),
    ...(options.tags ?? []).flatMap((tag, index) => sourceSecrets(`options.tags.${index}`, tag))
  ]
}

export function auditCodePenPrefillSecrets(payload: string): CodePenShowcaseDiagnostic[] {
  return sourceSecrets('codepen-prefill.json', payload)
}
