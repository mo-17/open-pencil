import type { BackendApplicationSpecV1, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import type { BackendProviderBundle } from './contracts'
import { sameBackendProviderDescriptor } from './descriptor'
import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from './nestjs/descriptor'

/** Only an already-resolved, reviewed V1 bundle may implement authored HTTP intent. */
export function unsupportedBackendHttpAPIDiagnostics(
  application: Pick<BackendApplicationSpecV1, 'httpApi' | 'commands' | 'commerce' | 'modules'> &
    Partial<Pick<BackendApplicationSpecV1, 'auth'>>,
  resolvedBundle?: BackendProviderBundle
): BackendDiagnostic[] {
  const conditionalAuthority = application.auth?.rowAccess.some(
    (policy) => policy.conditions !== undefined || policy.principal.kind === 'related-member'
  )
  if (
    application.httpApi === undefined &&
    !application.commands?.commands.length &&
    !application.commerce &&
    !application.modules &&
    !conditionalAuthority
  )
    return []
  if (
    resolvedBundle &&
    sameBackendProviderDescriptor(resolvedBundle.descriptor, NESTJS_BACKEND_PROVIDER_DESCRIPTOR)
  ) {
    return []
  }
  return [
    ...(application.modules
      ? [
          {
            code: 'backend-modules-provider-unimplemented',
            severity: 'error' as const,
            path: '$.application.modules',
            message:
              'Business module composition requires the reviewed NestJS modular application generator.'
          }
        ]
      : []),
    ...(conditionalAuthority
      ? [
          {
            code: 'backend-row-authority-provider-unimplemented',
            severity: 'error' as const,
            path: '$.application.auth.rowAccess',
            message:
              'Conditional row and related-member authority require the reviewed NestJS implementation.'
          }
        ]
      : []),
    ...(application.commerce
      ? [
          {
            code: 'backend-commerce-provider-unimplemented',
            severity: 'error' as const,
            path: '$.application.commerce',
            message:
              'Commerce requires the reviewed NestJS runtime, including financial ledgers and payment gates.'
          }
        ]
      : []),
    ...(application.commands?.commands.length
      ? [
          {
            code: 'backend-command-provider-unimplemented',
            severity: 'error' as const,
            path: '$.application.commands',
            message:
              'Atomic server commands require an explicitly reviewed provider implementation.'
          }
        ]
      : []),
    {
      code: 'backend-http-api-provider-unimplemented',
      severity: 'error',
      path: '$.application.httpApi',
      message:
        'HTTP API generation requires a Backend Provider implementation that is not yet available.'
    }
  ]
}
