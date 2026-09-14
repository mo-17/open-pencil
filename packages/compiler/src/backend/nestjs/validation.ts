import type { BackendApplicationSpecV1, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import type { BackendProviderAdapterContext } from '../contracts'
import { validateNestJSAuthorization } from './authorization'
import { validateNestJSCommands } from './commands/provider-validation'
import { nestJSDiagnostic } from './model'
import { validateNestJSModel } from './model-validation'
import { validateNestJSTenants } from './tenant/validation'

function validateEnvironment(application: BackendApplicationSpecV1): BackendDiagnostic[] {
  const authentication = application.httpApi?.authentication
  if (!authentication) return []
  const expected = [
    authentication.issuerEnvironment,
    authentication.audienceEnvironment,
    authentication.jwksUrlEnvironment,
    'DATABASE_URL'
  ]
  const reserved = new Set(['HOST', 'PORT', 'NODE_ENV'])
  if (
    new Set(expected).size !== 4 ||
    expected.some((name) => reserved.has(name)) ||
    application.secrets.length !== 4 ||
    !expected.every((name) =>
      application.secrets.some(
        (entry) =>
          entry.kind === 'environment' &&
          entry.name === name &&
          entry.exposure === 'server' &&
          entry.required
      )
    )
  ) {
    return [
      nestJSDiagnostic(
        '$.application.secrets',
        'NestJS v1 requires exactly four distinct required server environment references: JWT issuer, audience, JWKS URL, and DATABASE_URL.'
      )
    ]
  }
  return []
}

export function validateNestJSBackendProvider(
  context: BackendProviderAdapterContext
): BackendDiagnostic[] {
  const diagnostics = validateNestJSApplication(context.application)
  if (context.mode !== 'production' || !['react', 'vue'].includes(context.target)) {
    diagnostics.push(
      nestJSDiagnostic(
        '$.mode',
        'NestJS v1 generates complete server sources only for React/Vue production-mode source export; preview and partial prototype export are unsupported.'
      )
    )
  }
  return diagnostics
}

/** Shared semantic checks; connected preview never receives server emission authority. */
export function validateNestJSApplication(
  application: BackendApplicationSpecV1
): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  if (!application.httpApi) {
    diagnostics.push(
      nestJSDiagnostic(
        '$.application.httpApi',
        'NestJS generation requires an explicit HTTP API declaration.'
      )
    )
  }
  if (application.workflows.workflows.length > 0 || application.storage !== undefined) {
    diagnostics.push(
      nestJSDiagnostic('$.application', 'NestJS v1 does not yet implement workflows or storage.')
    )
  }
  diagnostics.push(
    ...validateNestJSModel(application),
    ...validateNestJSTenants(application),
    ...validateNestJSAuthorization(application),
    ...validateEnvironment(application),
    ...validateNestJSCommands(application)
  )
  return diagnostics
}
