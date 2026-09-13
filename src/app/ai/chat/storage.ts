import { computed, ref, watch } from 'vue'

import { IS_TAURI } from '@open-pencil/core/constants'

import { remoteMCPCredentialRevision, remoteMCPSettings } from '@/app/ai/mcp'
import {
  designCustomAPIType,
  designCustomBaseURL,
  designCustomModelID,
  designMaxOutputTokens,
  designModelConnection,
  designModelProfile,
  designModelID,
  designProviderDefinition,
  designProviderID,
  modelConnectionCredentialRef,
  modelCredentialRevision,
  setModelConnectionAPIKey
} from '@/app/ai/models'
import { appCredentialServices, browserCredentialsRemembered } from '@/app/settings/credentials/app'
import {
  refreshMediaCredentials,
  credentialPersistenceRevision
} from '@/app/settings/credentials/media'
import { initializeCredentialMigration } from '@/app/settings/credentials/migration'
import type { CredentialRef, CredentialStatus } from '@/app/settings/credentials/types'

export const providerID = designProviderID
export const modelID = designModelID
export const customBaseURL = designCustomBaseURL
export const customModelID = designCustomModelID
export const customAPIType = designCustomAPIType
export const maxOutputTokens = designMaxOutputTokens
export const providerDef = designProviderDefinition

export const apiKeyStatus = ref<CredentialStatus>('missing')

export const isACPProvider = computed(() => providerID.value.startsWith('acp:'))
export const isHarnessProvider = computed(() => providerID.value === 'harness:pi')
export const isAgentProvider = computed(() => isACPProvider.value || isHarnessProvider.value)

export const isConfigured = computed(() => {
  if (isACPProvider.value) return IS_TAURI
  if (isHarnessProvider.value) return IS_TAURI && apiKeyStatus.value === 'configured'
  if (apiKeyStatus.value !== 'configured') return false
  const needsBaseURL =
    providerID.value === 'openai-compatible' || providerID.value === 'anthropic-compatible'
  return !needsBaseURL || Boolean(customBaseURL.value)
})

async function refreshStatus(reference: CredentialRef): Promise<CredentialStatus> {
  return appCredentialServices.manager.status(reference)
}

function designCredentialReference(): CredentialRef | null {
  const connection = designModelConnection.value
  if (!connection || connection.providerID.startsWith('acp:')) return null
  return modelConnectionCredentialRef(connection)
}

export async function refreshAIProviderStatus(): Promise<void> {
  const reference = designCredentialReference()
  apiKeyStatus.value = reference ? await refreshStatus(reference) : 'missing'
}

export const credentialsReady = initializeCredentialMigration().then(async () => {
  await Promise.all([refreshAIProviderStatus(), refreshMediaCredentials()])
  return undefined
})

export async function resolveAPIKey(): Promise<string | null> {
  await credentialsReady
  const reference = designCredentialReference()
  return reference ? appCredentialServices.resolver.resolve(reference) : null
}

export async function setAPIKey(key: string): Promise<void> {
  const connection = designModelConnection.value
  if (!connection || connection.providerID.startsWith('acp:')) return
  const reference = modelConnectionCredentialRef(connection)
  await setModelConnectionAPIKey(connection.id, key)
  apiKeyStatus.value = await refreshStatus(reference)
}

export { browserCredentialsRemembered }

export function registerAIChatEffects(markTransportDirty: () => void) {
  watch(
    () => designModelConnection.value?.id,
    () => {
      void refreshAIProviderStatus()
      markTransportDirty()
    }
  )
  watch(modelID, markTransportDirty)
  watch(customModelID, markTransportDirty)
  watch(customAPIType, markTransportDirty)
  watch(customBaseURL, markTransportDirty)
  watch(maxOutputTokens, markTransportDirty)
  watch(() => {
    const profile = designModelProfile.value
    if (!profile) return null
    return [
      profile.reasoningEffort,
      profile.harnessThinkingLevel,
      profile.harnessPermissionMode,
      ...profile.capabilities,
      profile.featurePolicy.webSearch.enabled,
      profile.featurePolicy.codeExecution.enabled,
      ...profile.featurePolicy.mcpServerIds
    ]
  }, markTransportDirty)
  watch(credentialPersistenceRevision, () => {
    void refreshAIProviderStatus()
    markTransportDirty()
  })
  watch(modelCredentialRevision, markTransportDirty, { flush: 'sync' })
  watch(remoteMCPCredentialRevision, markTransportDirty)
  watch(
    () =>
      remoteMCPSettings.value.servers.map((server) => [
        server.id,
        server.name,
        server.transport.url,
        server.auth.type,
        server.auth.type === 'bearer' ? server.auth.credentialProfileId : ''
      ]),
    markTransportDirty
  )
}
