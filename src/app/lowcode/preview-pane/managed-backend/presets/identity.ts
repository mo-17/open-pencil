import {
  BACKEND_OIDC_CALLBACK_PATH,
  isBackendOIDCIssuer,
  type BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

export const MANAGED_BACKEND_PREVIEW_ORIGIN = 'http://127.0.0.1:5181'
export const LOCAL_KEYCLOAK_ISSUER = 'http://127.0.0.1:18080/realms/openpencil'
export const LOCAL_KEYCLOAK_JWKS =
  'https://127.0.0.1:18443/realms/openpencil/protocol/openid-connect/certs'

export function hasPublicDocumentAuthentication(
  authentication: BackendHttpAPIOIDCAuthenticationIRV1 | null
): authentication is BackendHttpAPIOIDCAuthenticationIRV1 {
  if (!authentication) return false
  return (
    isBackendOIDCIssuer(authentication.issuer) &&
    /^[\x21-\x7e]{1,256}$/u.test(authentication.clientId) &&
    authentication.callbackPath === BACKEND_OIDC_CALLBACK_PATH
  )
}

export function isHTTPSKeycloakIssuer(issuer: string): boolean {
  return (
    isBackendOIDCIssuer(issuer) &&
    issuer.startsWith('https:') &&
    /\/realms\/[A-Za-z0-9._~-]+$/u.test(new URL(issuer).pathname)
  )
}

export function isManagedPresetAudience(value: string): boolean {
  return value.length > 0 && value.length <= 512 && value.trim() === value && !/\p{Cc}/u.test(value)
}

export function isManagedPresetJWKS(value: string): boolean {
  if (!value || value.length > 2048 || /\p{Cc}/u.test(value)) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.href === value
    )
  } catch {
    return false
  }
}

export function isManagedPresetCAPath(value: string): boolean {
  return value.startsWith('/') && value.length <= 4096 && !/\p{Cc}/u.test(value)
}
