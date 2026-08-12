import { AI_PROVIDERS } from '@open-pencil/core/constants'

import { remoteMCPCredentialRefs } from '@/app/ai/mcp/credentials'
import { aiModelSettings, modelConnectionCredentialRef } from '@/app/ai/models'
import { VECTORIZE_CREDENTIAL_REFS } from '@/app/editor/vectorize/credentials'
import { storageCredentialRefs, storageProviderRegistry } from '@/app/integrations/storage'
import { SUPABASE_MANAGEMENT_PAT_CREDENTIAL } from '@/app/lowcode/supabase/credentials'
import { REVIEWED_EXTERNAL_SERVICE_CONNECTORS } from '@/app/plugins/connectors/services'
import { REVIEWED_DEPLOYMENT_PLUGINS } from '@/app/plugins/host/deployment/contract'
import {
  PEXELS_CREDENTIAL,
  UNSPLASH_CREDENTIAL,
  providerCredentialRef
} from '@/app/settings/credentials/migration'
import { credentialKey } from '@/app/settings/credentials/reference'

import { setBrowserCredentialPersistence } from './app'
import type { CredentialRef } from './types'

function uniqueCredentialRefs(references: CredentialRef[]): CredentialRef[] {
  return [...new Map(references.map((reference) => [credentialKey(reference), reference])).values()]
}

export function appCredentialRefs(): CredentialRef[] {
  const legacyAIRefs = AI_PROVIDERS.filter((provider) => !provider.id.startsWith('acp:')).map(
    (provider) => providerCredentialRef(provider.id)
  )
  const modelConnectionRefs = aiModelSettings.value.connections
    .filter((connection) => !connection.providerID.startsWith('acp:'))
    .map(modelConnectionCredentialRef)
  const storageCredentials = storageProviderRegistry
    .list()
    .flatMap((provider) => storageCredentialRefs(provider.id))
  const deploymentCredentials = REVIEWED_DEPLOYMENT_PLUGINS.map(
    (definition) => definition.credentialRef
  )
  const externalServiceCredentials = REVIEWED_EXTERNAL_SERVICE_CONNECTORS.flatMap((connector) =>
    Object.values(connector.credentialRefs())
  )
  return uniqueCredentialRefs([
    ...legacyAIRefs,
    ...modelConnectionRefs,
    PEXELS_CREDENTIAL,
    UNSPLASH_CREDENTIAL,
    SUPABASE_MANAGEMENT_PAT_CREDENTIAL,
    ...VECTORIZE_CREDENTIAL_REFS,
    ...remoteMCPCredentialRefs(),
    ...storageCredentials,
    ...deploymentCredentials,
    ...externalServiceCredentials
  ])
}

export function setAppCredentialPersistence(remembered: boolean): Promise<void> {
  return setBrowserCredentialPersistence(remembered, appCredentialRefs())
}
