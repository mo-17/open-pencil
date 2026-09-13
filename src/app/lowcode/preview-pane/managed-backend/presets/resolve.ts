import {
  hasPublicDocumentAuthentication,
  isHTTPSKeycloakIssuer,
  isManagedPresetAudience,
  isManagedPresetCAPath,
  isManagedPresetJWKS,
  LOCAL_KEYCLOAK_ISSUER,
  LOCAL_KEYCLOAK_JWKS
} from './identity'
import type {
  ManagedBackendPresetDraft,
  ManagedBackendPresetInput,
  ManagedBackendPresetIssue,
  ManagedBackendPresetMissing,
  ManagedBackendPresetResolution
} from './types'

function identityIssue(input: ManagedBackendPresetInput): ManagedBackendPresetIssue | null {
  const { authentication, presetId } = input
  if (!hasPublicDocumentAuthentication(authentication)) return 'document-authentication-required'
  if (presetId === 'local-keycloak' && authentication.issuer !== LOCAL_KEYCLOAK_ISSUER)
    return 'local-keycloak-issuer-required'
  if (presetId === 'https-keycloak' && !isHTTPSKeycloakIssuer(authentication.issuer))
    return 'https-keycloak-issuer-required'
  return null
}

function suggestions(input: ManagedBackendPresetInput): Partial<ManagedBackendPresetDraft> {
  const { authentication, presetId, draft } = input
  if (!authentication) return {}
  const suggestedAudience =
    authentication.resource || (presetId === 'local-keycloak' ? 'openpencil-notes-api' : '')
  const suggestedJWKS = {
    'local-keycloak': LOCAL_KEYCLOAK_JWKS,
    'https-keycloak': authentication.issuer + '/protocol/openid-connect/certs',
    oidc: ''
  }[presetId]
  return {
    ...(!draft.audience.trim() && suggestedAudience ? { audience: suggestedAudience } : {}),
    ...(!draft.jwksURL.trim() && suggestedJWKS ? { jwksURL: suggestedJWKS } : {})
  }
}

function fieldIssues(draft: ManagedBackendPresetDraft): ManagedBackendPresetIssue[] {
  const issues: ManagedBackendPresetIssue[] = []
  if (draft.audience && !isManagedPresetAudience(draft.audience)) issues.push('invalid-audience')
  if (draft.jwksURL && !isManagedPresetJWKS(draft.jwksURL)) issues.push('invalid-jwks-url')
  if (draft.caFile && !isManagedPresetCAPath(draft.caFile)) issues.push('invalid-ca-path')
  return issues
}

/** Pure, bounded suggestions; neither selecting nor inspecting a preset changes configuration. */
export function resolveManagedBackendPreset(
  input: ManagedBackendPresetInput
): ManagedBackendPresetResolution {
  const issue = identityIssue(input)
  const patch = Object.freeze(issue ? {} : suggestions(input))
  const next = { ...input.draft, ...patch }
  const missing: ManagedBackendPresetMissing[] = []
  if (issue === 'document-authentication-required') missing.push('authentication')
  if (!next.audience.trim()) missing.push('audience')
  if (!next.jwksURL.trim()) missing.push('jwksURL')
  if (input.presetId === 'local-keycloak' && !next.caFile.trim()) missing.push('caFile')
  const issues = [...(issue ? [issue] : []), ...fieldIssues(next)]
  return Object.freeze({
    presetId: input.presetId,
    applicable: issue === null,
    patch,
    missing: Object.freeze(missing),
    issues: Object.freeze(issues),
    ready: missing.length === 0 && issues.length === 0
  })
}
