import type { BackendApplicationSpecV1, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import type { BackendProviderBundle } from './contracts'
import { sameBackendProviderDescriptor } from './descriptor'
import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from './nestjs/descriptor'

/** Only an already-resolved, reviewed V1 bundle may implement authored HTTP intent. */
export function unsupportedBackendHttpAPIDiagnostics(
  application: Pick<BackendApplicationSpecV1, 'httpApi' | 'commands'>,
  resolvedBundle?: BackendProviderBundle
): BackendDiagnostic[] {
  if (application.httpApi === undefined && !application.commands?.commands.length) return []
  if (
    resolvedBundle &&
    sameBackendProviderDescriptor(resolvedBundle.descriptor, NESTJS_BACKEND_PROVIDER_DESCRIPTOR)
  ) {
    return []
  }
  return [
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
