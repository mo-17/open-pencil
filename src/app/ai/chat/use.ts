import { ref } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import {
  apiKeyStatus,
  browserCredentialsRemembered,
  credentialsReady,
  customAPIType,
  customBaseURL,
  customModelID,
  isACPProvider,
  isHarnessProvider,
  isConfigured,
  maxOutputTokens,
  modelID,
  pexelsKeyStatus,
  providerDef,
  providerID,
  registerAIChatEffects,
  resolveAPIKey,
  setAPIKey,
  setPexelsKey,
  setRememberCredentials,
  setUnsplashKey,
  unsplashKeyStatus
} from '@/app/ai/chat/storage'
import { createChatSessionManager } from '@/app/ai/chat/transports'
import { remoteMCPSettingsSnapshot } from '@/app/ai/mcp'
import { resolveAIModelRole } from '@/app/ai/models'
import { getAISessionStore } from '@/app/ai/sessions'
import { exposeChatTransportOverride } from '@/app/browser-bridge'
import { getActiveEditorStore } from '@/app/editor/active-store'

const activeTab = ref<'design' | 'code' | 'ai'>('design')

function resolveACPConfigurationContext(role: NonNullable<ReturnType<typeof resolveAIModelRole>>) {
  const selected = new Set(role.profile.featurePolicy.mcpServerIds)
  return remoteMCPSettingsSnapshot()
    .servers.filter((server) => selected.has(server.id))
    .sort((first, second) => first.id.localeCompare(second.id))
    .map((server) => ({
      id: server.id,
      url: server.transport.url,
      authType: server.auth.type,
      credentialProfileId: server.auth.type === 'bearer' ? server.auth.credentialProfileId : null
    }))
}

const chatSession = createChatSessionManager({
  isConfigured,
  isACPProvider,
  isHarnessProvider,
  providerID,
  credentialsReady,
  getActiveEditorStore,
  acpSessionStore: getAISessionStore(),
  resolveACPModelRole: () => resolveAIModelRole('design'),
  resolveACPConfigurationContext
})

registerAIChatEffects(chatSession.markTransportDirty)

if (IS_BROWSER) {
  exposeChatTransportOverride((factory) => {
    chatSession.setOverrideTransport(factory)
  })
}

export function useAIChat() {
  return {
    providerID,
    providerDef,
    apiKeyStatus,
    browserCredentialsRemembered,
    setAPIKey,
    resolveAPIKey,
    modelID,
    customBaseURL,
    customModelID,
    customAPIType,
    maxOutputTokens,
    acpConfigOptions: chatSession.acpConfigOptions,
    acpConfigUpdating: chatSession.acpConfigUpdating,
    acpSessionStatus: chatSession.acpSessionStatus,
    acpSessionHistory: chatSession.acpSessionHistory,
    acpSessionRestoreNotice: chatSession.acpSessionRestoreNotice,
    refreshACPSessionHistory: chatSession.refreshACPSessionHistory,
    restoreACPSession: chatSession.restoreACPSession,
    setACPConfigOption: chatSession.setACPConfigOption,
    pexelsKeyStatus,
    setPexelsKey,
    setRememberCredentials,
    unsplashKeyStatus,
    setUnsplashKey,
    activeTab,
    isConfigured,
    ensureChat: chatSession.ensureChat,
    respondToToolApproval: chatSession.respondToToolApproval,
    sessionRevision: chatSession.sessionRevision,
    resetChat: chatSession.resetChat,
    forceStopChat: chatSession.forceStopChat,
    chatFailure: chatSession.failure,
    clearChatFailure: chatSession.clearFailure
  }
}
