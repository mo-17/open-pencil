import {
  isBackendOIDCIssuer,
  type BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

export type TemplateAuthenticationProfile = 'local-keycloak' | 'oidc'

/** Public client configuration only; secrets remain owned by the runtime settings. */
export function templateAuthentication(
  profile: TemplateAuthenticationProfile,
  issuer: string,
  clientId: string
): BackendHttpAPIOIDCAuthenticationIRV1 {
  return {
    kind: 'oidc-pkce',
    issuer:
      profile === 'local-keycloak' ? 'http://127.0.0.1:18080/realms/openpencil' : issuer.trim(),
    clientId: profile === 'local-keycloak' ? 'notes-public-client' : clientId.trim(),
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  }
}

export function validTemplateAuthentication(
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
): boolean {
  return (
    isBackendOIDCIssuer(authentication.issuer) &&
    /^[\x21-\x7e]{1,256}$/u.test(authentication.clientId)
  )
}
