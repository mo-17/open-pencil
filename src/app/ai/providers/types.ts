import type { LanguageModel, ToolLoopAgentSettings, ToolSet } from 'ai'

import type { AIProviderID } from '@open-pencil/core/constants'

import type { FetchFunction } from '@/app/http/types'

export type ModelConfig = {
  providerID: AIProviderID
  apiKey: string
  modelID: string
  customModelID: string
  customBaseURL: string
  customAPIType: 'completions' | 'responses'
}

export type ModelProviderAdapterContext = {
  fetch?: FetchFunction
}

export type ProviderFeaturePolicy = {
  webSearch?: {
    enabled: boolean
    engine?: 'auto' | 'native' | 'exa'
    maxResults?: number
  }
  codeExecution?: {
    enabled: boolean
  }
}

export type ProviderCapabilityOwner = 'application' | 'provider' | 'gateway' | 'acp-agent'
export type ProviderCapabilityEvidence = 'adapter' | 'catalog' | 'user' | 'probe'

export type ProviderCapabilitySupport =
  | {
      state: 'supported'
      owner: ProviderCapabilityOwner
      api?: 'chat' | 'responses' | 'messages' | 'generate-content'
      evidence: ProviderCapabilityEvidence
      constraints?: Record<string, unknown>
    }
  | { state: 'unsupported'; reason: string }
  | { state: 'unknown'; reason: string }

export type ProviderCapabilityReport = {
  functionTools: ProviderCapabilitySupport
  imageInput: ProviderCapabilitySupport
  webSearch: ProviderCapabilitySupport
  codeExecution: ProviderCapabilitySupport
  mcpTools: ProviderCapabilitySupport
}

export type ProviderModelRuntime = {
  model: LanguageModel
  capabilities: ProviderCapabilityReport
  providerTools: ToolSet
  providerOptions?: ToolLoopAgentSettings['providerOptions']
  dispose?: () => Promise<void>
}

export interface ModelProviderAdapter {
  create(
    config: ModelConfig,
    context: ModelProviderAdapterContext,
    policy?: ProviderFeaturePolicy
  ): ProviderModelRuntime
}
