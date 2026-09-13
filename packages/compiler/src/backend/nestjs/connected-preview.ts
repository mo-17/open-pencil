import type { CompilerTarget } from '#compiler/types'

import {
  parseBackendApplicationSpecV1,
  validateBackendCapabilityDeclarations,
  type BackendApplicationSpecV1,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'

import { freezeBackendValue } from '../canonical'
import type { BackendProviderSelection } from '../contracts'
import { sameBackendProviderDescriptor } from '../descriptor'
import { sortBackendDiagnostics } from '../diagnostics'
import { BackendProviderRegistry } from '../registry'
import { NESTJS_BACKEND_PROVIDER_BUNDLE } from './bundle'
import { NESTJS_BACKEND_PROVIDER_DESCRIPTOR } from './descriptor'
import { nestJSPreviewApplicationDigest } from './preview-digest'
import { validateNestJSApplication } from './validation'

export interface NestJSConnectedPreviewInput {
  readonly selection: BackendProviderSelection
  readonly application: unknown
  readonly target: CompilerTarget
  readonly applicationDigest: string
}

export type NestJSConnectedPreviewResult =
  | Readonly<{
      ok: true
      application: BackendApplicationSpecV1
      applicationDigest: string
    }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>

function rejected(code: string, message: string): NestJSConnectedPreviewResult {
  return {
    ok: false,
    diagnostics: [{ code, severity: 'error', path: '$.options.backendPreview', message }]
  }
}

/**
 * Authorizes frontend generation against an explicitly connected host service only.
 * This is not a Provider plan, a release receipt, or permission to emit/execute a server.
 */
export function validateNestJSConnectedPreview(
  input: NestJSConnectedPreviewInput
): NestJSConnectedPreviewResult {
  if (input.target !== 'react' && input.target !== 'vue') {
    return rejected(
      'backend-preview-target-unsupported',
      'Connected NestJS preview requires React or Vue.'
    )
  }
  const resolved = new BackendProviderRegistry([NESTJS_BACKEND_PROVIDER_BUNDLE]).resolve(
    input.selection
  )
  if (!resolved.ok) return resolved
  if (
    !sameBackendProviderDescriptor(
      resolved.value.bundle.descriptor,
      NESTJS_BACKEND_PROVIDER_DESCRIPTOR
    )
  ) {
    return rejected(
      'backend-preview-provider-unsupported',
      'Connected preview requires the reviewed NestJS Provider.'
    )
  }
  const parsed = parseBackendApplicationSpecV1(input.application)
  if (!parsed.ok) return parsed
  const application = parsed.value
  if (!application.httpApi?.browserClient) {
    return rejected(
      'backend-preview-browser-client-required',
      'Connected NestJS preview requires browser authentication and API bindings.'
    )
  }
  if (
    application.httpApi.resources.some((resource) => /^\/_openpencil(?:\/|$)/iu.test(resource.path))
  ) {
    return rejected(
      'backend-preview-resource-path-reserved',
      'Connected preview reserves the /_openpencil namespace. Use another API resource path.'
    )
  }
  const diagnostics = [
    ...validateBackendCapabilityDeclarations(application),
    ...validateNestJSApplication(application)
  ]
  const supported = new Set<string>(NESTJS_BACKEND_PROVIDER_DESCRIPTOR.capabilities)
  for (const requirement of application.capabilities) {
    if (!supported.has(requirement.capability)) {
      diagnostics.push({
        code: 'backend-preview-capability-unsupported',
        severity: 'error',
        path: `$.capabilities.${requirement.capability}`,
        message: 'Connected preview cannot supply this Backend capability.'
      })
    }
  }
  if (diagnostics.some((entry) => entry.severity === 'error')) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }
  const applicationDigest = nestJSPreviewApplicationDigest(application)
  if (input.applicationDigest !== applicationDigest) {
    return rejected(
      'backend-preview-application-changed',
      'The Backend contract changed. Reconnect a matching local server before previewing.'
    )
  }
  return Object.freeze({
    ok: true,
    application: freezeBackendValue(application) as BackendApplicationSpecV1,
    applicationDigest
  })
}
