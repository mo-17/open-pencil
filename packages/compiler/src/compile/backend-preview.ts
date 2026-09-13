import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { validateNestJSConnectedPreview } from '../backend/nestjs/connected-preview'
import type { CompilerBackendProviderRequest, CompilerOptions } from '../types'

/** Read only exact own data; an authored document is never a preview connection. */
function readConnection(value: unknown): NonNullable<CompilerOptions['backendPreview']> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Preview connection must be a plain record.')
  const prototype = Object.getPrototypeOf(value)
  const keys = Reflect.ownKeys(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== 2 ||
    keys.some((key) => key !== 'kind' && key !== 'applicationDigest')
  )
    throw new TypeError('Preview connection must contain exact fields.')
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')
  const digest = Object.getOwnPropertyDescriptor(value, 'applicationDigest')
  if (
    !kind?.enumerable ||
    !('value' in kind) ||
    kind.value !== 'nestjs-local' ||
    !digest?.enumerable ||
    !('value' in digest) ||
    typeof digest.value !== 'string'
  )
    throw new TypeError('Preview connection fields must contain plain data.')
  return { kind: 'nestjs-local', applicationDigest: digest.value }
}

/** Kept separate from Provider plan modes: connected preview cannot emit a server. */
export function resolveCompilerBackendPreview(
  options: CompilerOptions,
  request: CompilerBackendProviderRequest | undefined
): BackendApplicationSpecV1 | undefined {
  let value: unknown
  try {
    value = options.backendPreview
  } catch {
    throw new Error('Backend preview configuration must be plain data.')
  }
  if (value === undefined) return undefined
  let connection: NonNullable<CompilerOptions['backendPreview']>
  try {
    connection = readConnection(value)
  } catch {
    throw new Error('Backend preview configuration must contain only kind and applicationDigest.')
  }
  if (
    !options.devMode ||
    (options.backendCompilationMode !== undefined &&
      options.backendCompilationMode !== 'preview') ||
    options.packaging?.kind === 'microfrontend' ||
    !request
  ) {
    throw new Error(
      'Connected NestJS preview requires an explicit Provider and standalone devMode project.'
    )
  }
  const result = validateNestJSConnectedPreview({
    selection: request.selection,
    application: request.application,
    target: options.target,
    applicationDigest: connection.applicationDigest
  })
  if (!result.ok) {
    throw new Error(
      `Connected NestJS preview failed closed: ${result.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  }
  return result.application
}
