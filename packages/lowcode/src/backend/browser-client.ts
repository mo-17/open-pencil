import {
  BACKEND_OIDC_CALLBACK_PATH,
  type BackendHttpAPIBrowserClientIRV1,
  type BackendHttpAPIOIDCAuthenticationIRV1
} from './types'
import {
  diagnostic,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'

/** Public OIDC issuer identifiers keep their exact trailing-slash semantics. */
export function isBackendOIDCIssuer(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2048 ||
    /[\s\\]/u.test(value)
  )
    return false
  try {
    const url = new URL(value)
    const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname)
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.href === value || (url.pathname === '/' && url.href === value + '/'))
    )
  } catch {
    return false
  }
}

export function isBackendClientPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && /^(?:\/[A-Za-z0-9_-]+)+$/u.test(value)
}

export function isBackendAuthReturnPath(value: unknown): value is string {
  return value === '/' || (isBackendClientPath(value) && !value.startsWith('/_openpencil/'))
}

function invalid(context: BackendValidationContext, path: string, message: string): void {
  diagnostic(context, 'backend-browser-client-invalid', path, message)
}

function oidcConfiguration(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendHttpAPIOIDCAuthenticationIRV1 | undefined {
  const source = record(
    value,
    path,
    context,
    ['kind', 'issuer', 'clientId', 'scopes', 'callbackPath', 'resource'],
    ['kind', 'issuer', 'clientId', 'scopes', 'callbackPath']
  )
  if (!source) return undefined
  const kind = oneOf(source.kind, path + '.kind', context, ['oidc-pkce'])
  const issuer = isBackendOIDCIssuer(source.issuer) ? source.issuer : undefined
  if (!issuer)
    invalid(
      context,
      path + '.issuer',
      'Use an exact HTTPS issuer without credentials, query or fragment; HTTP is allowed only on numeric loopback.'
    )
  const clientId =
    typeof source.clientId === 'string' && /^[\x21-\x7e]{1,256}$/u.test(source.clientId)
      ? source.clientId
      : undefined
  if (!clientId)
    invalid(context, path + '.clientId', 'A bounded public OIDC client ID is required.')
  const scopes = parseArrayItems(
    source.scopes,
    path + '.scopes',
    context,
    8,
    (entry, scopePath) => {
      if (
        typeof entry === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(entry) &&
        entry !== 'offline_access'
      )
        return entry
      invalid(
        context,
        scopePath,
        'Use bounded scope tokens; offline_access is not supported by this browser client.'
      )
      return undefined
    }
  )
  if (scopes) {
    uniqueBy(scopes, path + '.scopes', context, 'OIDC scope')
    if (!scopes.includes('openid'))
      invalid(context, path + '.scopes', 'The openid scope is required.')
  }
  if (source.callbackPath !== BACKEND_OIDC_CALLBACK_PATH)
    invalid(context, path + '.callbackPath', 'Use the reserved OpenPencil OIDC callback path.')
  let resource: string | undefined
  if (source.resource !== undefined) {
    if (isBackendOIDCIssuer(source.resource) && source.resource.startsWith('https:'))
      resource = source.resource
    else
      invalid(
        context,
        path + '.resource',
        'The optional authorization resource must be a bounded HTTPS URI.'
      )
  }
  if (!kind || !issuer || !clientId || !scopes) return undefined
  return {
    kind,
    issuer,
    clientId,
    scopes: sorted(scopes, (entry) => entry),
    callbackPath: BACKEND_OIDC_CALLBACK_PATH,
    ...(resource === undefined ? {} : { resource })
  }
}

/** The application parser has already bounded and snapshotted this secret-free section. */
export function parseBackendBrowserClient(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendHttpAPIBrowserClientIRV1 | undefined {
  const source = record(value, path, context, ['version', 'apiBasePath', 'authentication'])
  if (!source) return undefined
  if (source.version !== 1)
    invalid(context, path + '.version', 'Browser client version is not supported.')
  const apiBasePath = isBackendClientPath(source.apiBasePath) ? source.apiBasePath : undefined
  if (!apiBasePath || apiBasePath.startsWith('/_openpencil'))
    invalid(
      context,
      path + '.apiBasePath',
      'The API mount must be a same-origin static path outside the reserved callback namespace.'
    )
  const authentication = oidcConfiguration(source.authentication, path + '.authentication', context)
  if (!apiBasePath || !authentication) return undefined
  return { version: 1, apiBasePath, authentication }
}
