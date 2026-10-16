import type { BackendApplicationSpecV1, BackendCredentialRef } from '@open-pencil/lowcode/backend'

export function requiredSupabaseSecretReferences(application: BackendApplicationSpecV1): Readonly<{
  environmentNames: readonly string[]
  credentialRefs: readonly BackendCredentialRef[]
}> {
  const environmentNames = application.secrets.flatMap((secret) =>
    secret.kind === 'environment' && secret.required ? [secret.name] : []
  )
  const credentialRefs = application.secrets.flatMap((secret) =>
    secret.kind === 'credential' && secret.required ? [secret.credentialRef] : []
  )
  return Object.freeze({
    environmentNames: Object.freeze([...new Set(environmentNames)].sort()),
    credentialRefs: Object.freeze([...new Set(credentialRefs)].sort())
  })
}
