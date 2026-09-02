import {
  containsBackendSecretLikeMaterial,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'

const SEVERITY_ORDER: Readonly<Record<BackendDiagnostic['severity'], number>> = Object.freeze({
  error: 0,
  warning: 1,
  info: 2
})

export function backendDiagnostic(
  code: string,
  severity: BackendDiagnostic['severity'],
  path: string,
  message: string
): BackendDiagnostic {
  return Object.freeze({ code, severity, path, message })
}

export function unsupportedBackendCompilationModeDiagnostic(): BackendDiagnostic {
  return backendDiagnostic(
    'backend-compilation-mode-unsupported',
    'error',
    '$.mode',
    'Compiler Backend mode is unsupported.'
  )
}

export function sortBackendDiagnostics(
  diagnostics: readonly BackendDiagnostic[]
): readonly BackendDiagnostic[] {
  return Object.freeze(
    [...diagnostics].sort(
      (left, right) =>
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        left.code.localeCompare(right.code, 'en') ||
        left.path.localeCompare(right.path, 'en') ||
        left.message.localeCompare(right.message, 'en')
    )
  )
}

export function hasBackendErrors(diagnostics: readonly BackendDiagnostic[]): boolean {
  return diagnostics.some((entry) => entry.severity === 'error')
}

export function normalizeProviderDiagnostics(
  value: readonly BackendDiagnostic[],
  path: string
): readonly BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index] as BackendDiagnostic | undefined
    if (
      !entry ||
      typeof entry.code !== 'string' ||
      !/^[a-z][a-z0-9-]{0,127}$/u.test(entry.code) ||
      !['error', 'warning', 'info'].includes(entry.severity) ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.length > 1024 ||
      typeof entry.message !== 'string' ||
      entry.message.length === 0 ||
      entry.message.length > 4096 ||
      containsBackendSecretLikeMaterial(entry.path) ||
      containsBackendSecretLikeMaterial(entry.message)
    ) {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-diagnostic-invalid',
          'error',
          `${path}[${index}]`,
          'Backend Provider returned a malformed diagnostic.'
        )
      )
      continue
    }
    diagnostics.push(backendDiagnostic(entry.code, entry.severity, entry.path, entry.message))
  }
  return sortBackendDiagnostics(diagnostics)
}
