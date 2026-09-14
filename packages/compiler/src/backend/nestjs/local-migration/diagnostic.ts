import type { BackendDiagnostic } from '@open-pencil/lowcode/backend'

export function localMigrationDiagnostic(
  code: string,
  path: string,
  message: string
): BackendDiagnostic {
  return { code: 'backend-local-migration-' + code, severity: 'error', path, message }
}
