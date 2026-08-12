import type { LanguageModel, ToolLoopAgentSettings, ToolSet } from 'ai'
import { readonly, ref } from 'vue'

import { createProviderModelRuntime } from '@/app/ai/chat/model'
import {
  createRemoteMCPRuntime,
  MAX_REMOTE_MCP_TOOL_PAGES,
  MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES,
  mergeRemoteMCPTools,
  REMOTE_MCP_DISCOVERY_TIMEOUT_MS,
  REMOTE_MCP_INITIALIZATION_TIMEOUT_MS,
  type RemoteMCPRuntime
} from '@/app/ai/mcp'
import { modelConnection, resolveAIModelRole } from '@/app/ai/models/store'
import type { AIModelConnection, AIModelRole, ResolvedAIModelRole } from '@/app/ai/models/types'
import type { ProviderCapabilityReport } from '@/app/ai/providers/types'
import { settleRuntimeDisposals } from '@/app/ai/runtime-disposal'
import { appCredentialServices } from '@/app/settings/credentials/app'
import {
  initializeCredentialMigration,
  providerCredentialRef
} from '@/app/settings/credentials/migration'
import type { CredentialRef, CredentialStatus } from '@/app/settings/credentials/types'

export type DirectAIModelRuntime = {
  kind: 'direct'
  role: ResolvedAIModelRole
  model: LanguageModel
  capabilities: ProviderCapabilityReport
  providerTools: ToolSet
  providerOptions?: ToolLoopAgentSettings['providerOptions']
  dispose?: () => Promise<void>
}

export type ACPModelRuntime = {
  kind: 'acp'
  role: ResolvedAIModelRole
}

export type AIModelRuntime = DirectAIModelRuntime | ACPModelRuntime

const mutableModelCredentialRevision = ref(0)
export const modelCredentialRevision = readonly(mutableModelCredentialRevision)

function combineRuntimeDisposers(
  ...disposers: Array<(() => Promise<void>) | undefined>
): (() => Promise<void>) | undefined {
  const active = disposers.filter(
    (dispose): dispose is () => Promise<void> => dispose !== undefined
  )
  if (active.length === 0) return undefined
  let promise: Promise<void> | undefined
  return () => {
    promise ??= settleRuntimeDisposals(active, 'Failed to dispose AI model runtime')
    return promise
  }
}

export function modelConnectionCredentialRef(connection: AIModelConnection): CredentialRef {
  return providerCredentialRef(connection.providerID, connection.credentialProfileId)
}

function assertProviderFeatureSupport(
  enabled: boolean,
  state: string,
  feature: string,
  providerID: string
): void {
  if (enabled && state !== 'supported') {
    throw new Error(`${feature} is not supported by the ${providerID} provider adapter`)
  }
}

export async function modelConnectionCredentialStatus(
  connectionId: string
): Promise<CredentialStatus> {
  const connection = modelConnection(connectionId)
  if (!connection || connection.providerID.startsWith('acp:')) return 'missing'
  return appCredentialServices.manager.status(modelConnectionCredentialRef(connection))
}

export async function setModelConnectionAPIKey(connectionId: string, value: string): Promise<void> {
  const connection = modelConnection(connectionId)
  if (!connection || connection.providerID.startsWith('acp:')) return
  const reference = modelConnectionCredentialRef(connection)
  const key = value.trim()
  if (key) await appCredentialServices.manager.set(reference, key)
  else await appCredentialServices.manager.clear(reference)
  mutableModelCredentialRevision.value++
}

export async function resolveModelConnectionAPIKey(connectionId: string): Promise<string | null> {
  await initializeCredentialMigration()
  const connection = modelConnection(connectionId)
  if (!connection || connection.providerID.startsWith('acp:')) return null
  return appCredentialServices.resolver.resolve(modelConnectionCredentialRef(connection))
}

export async function createAIModelRuntime(role: AIModelRole): Promise<AIModelRuntime | null> {
  const resolved = resolveAIModelRole(role)
  if (!resolved) return null
  if (role === 'design' && !resolved.profile.capabilities.includes('tools')) {
    throw new Error('The Design model must support tools')
  }
  if (role === 'vision' && !resolved.profile.capabilities.includes('vision')) {
    throw new Error('The Vision model must support image input')
  }
  if (resolved.connection.providerID.startsWith('acp:')) {
    if (role !== 'design') {
      throw new Error('ACP agents can only be assigned to the Design agent role')
    }
    return { kind: 'acp', role: resolved }
  }

  const apiKey = await resolveModelConnectionAPIKey(resolved.connection.id)
  if (!apiKey) throw new Error(`Credential is unavailable for the ${role} model role`)
  const providerRuntime = createProviderModelRuntime(
    {
      providerID: resolved.connection.providerID,
      apiKey,
      modelID: resolved.profile.modelID,
      customModelID: resolved.profile.customModelID,
      customBaseURL: resolved.connection.customBaseURL,
      customAPIType: resolved.connection.customAPIType
    },
    {
      webSearch: resolved.profile.featurePolicy.webSearch,
      codeExecution: resolved.profile.featurePolicy.codeExecution
    }
  )
  let remoteMCPRuntime: RemoteMCPRuntime | undefined
  let providerTools = providerRuntime.providerTools
  try {
    assertProviderFeatureSupport(
      resolved.profile.featurePolicy.webSearch.enabled,
      providerRuntime.capabilities.webSearch.state,
      'Web search',
      resolved.connection.providerID
    )
    assertProviderFeatureSupport(
      resolved.profile.featurePolicy.codeExecution.enabled,
      providerRuntime.capabilities.codeExecution.state,
      'Code execution',
      resolved.connection.providerID
    )
    if (role === 'design' && resolved.profile.featurePolicy.mcpServerIds.length > 0) {
      remoteMCPRuntime = await createRemoteMCPRuntime(resolved.profile.featurePolicy.mcpServerIds)
      providerTools = mergeRemoteMCPTools(providerTools, remoteMCPRuntime.tools)
    }
  } catch (error) {
    await Promise.allSettled([
      Promise.resolve().then(() => providerRuntime.dispose?.()),
      Promise.resolve().then(() => remoteMCPRuntime?.dispose())
    ])
    throw error
  }

  const providerDispose = providerRuntime.dispose
  const dispose = combineRuntimeDisposers(
    providerDispose ? () => providerDispose() : undefined,
    remoteMCPRuntime ? () => remoteMCPRuntime.dispose() : undefined
  )
  const capabilities = remoteMCPRuntime
    ? {
        ...providerRuntime.capabilities,
        mcpTools: {
          state: 'supported' as const,
          owner: 'application' as const,
          evidence: 'user' as const,
          constraints: {
            transport: 'streamable-http',
            directFetch: 'webview',
            requiresCors: true,
            serverCount: resolved.profile.featurePolicy.mcpServerIds.length,
            maxToolPagesPerServer: MAX_REMOTE_MCP_TOOL_PAGES,
            maxTransportResponseBytes: MAX_REMOTE_MCP_TRANSPORT_RESPONSE_BYTES,
            discoveryTimeoutMs: REMOTE_MCP_DISCOVERY_TIMEOUT_MS,
            initializationTimeoutMs: REMOTE_MCP_INITIALIZATION_TIMEOUT_MS
          }
        }
      }
    : providerRuntime.capabilities
  return {
    kind: 'direct',
    role: resolved,
    model: providerRuntime.model,
    capabilities,
    providerTools,
    providerOptions: providerRuntime.providerOptions,
    dispose
  }
}
