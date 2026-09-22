export const MANAGED_DIAGNOSTIC_CODES = [
  'preview-configuration',
  'ca-file',
  'node-runtime',
  'npm-runtime',
  'docker-runtime',
  'api-port',
  'preview-port',
  'database',
  'migration',
  'oidc-discovery',
  'jwks'
] as const
export const MANAGED_DIAGNOSTIC_STATUSES = [
  'passed',
  'failed',
  'unavailable',
  'tls',
  'missing'
] as const
export interface ManagedPreviewDiagnostic {
  readonly code: (typeof MANAGED_DIAGNOSTIC_CODES)[number]
  readonly status: (typeof MANAGED_DIAGNOSTIC_STATUSES)[number]
}
