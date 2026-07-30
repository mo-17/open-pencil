import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

import type {
  ModelConfig,
  ModelProviderAdapter,
  ProviderCapabilityReport,
  ProviderModelRuntime
} from '@/app/ai/providers/types'

export type CompatibleEndpoint = string | ((config: ModelConfig) => string)

type OpenAICompatibleOptions = {
  baseURL?: CompatibleEndpoint
  mode?: 'default' | 'chat' | 'configurable'
  openAIResponsesTools?: boolean
}

type AnthropicCompatibleOptions = {
  baseURL?: CompatibleEndpoint
}

function resolveEndpoint(endpoint: CompatibleEndpoint | undefined, config: ModelConfig) {
  return typeof endpoint === 'function' ? endpoint(config) : endpoint
}

const COMPATIBLE_CAPABILITIES: ProviderCapabilityReport = {
  functionTools: {
    state: 'supported',
    owner: 'application',
    evidence: 'adapter'
  },
  imageInput: { state: 'unknown', reason: 'Image input support depends on the selected model' },
  webSearch: { state: 'unsupported', reason: 'The compatible adapter does not expose web search' },
  codeExecution: {
    state: 'unsupported',
    reason: 'The compatible adapter does not expose code execution'
  },
  mcpTools: { state: 'unsupported', reason: 'The compatible adapter does not expose MCP tools' }
}

const OPENAI_RESPONSES_CAPABILITIES: ProviderCapabilityReport = {
  ...COMPATIBLE_CAPABILITIES,
  codeExecution: {
    state: 'supported',
    owner: 'provider',
    api: 'responses',
    evidence: 'adapter',
    constraints: { runtime: 'provider-hosted-python', container: 'auto' }
  }
}

function compatibleRuntime(
  model: ProviderModelRuntime['model'],
  capabilities: ProviderCapabilityReport = COMPATIBLE_CAPABILITIES,
  providerTools: ProviderModelRuntime['providerTools'] = {}
): ProviderModelRuntime {
  return {
    model,
    capabilities,
    providerTools
  }
}

export function createOpenAICompatibleAdapter(
  options: OpenAICompatibleOptions = {}
): ModelProviderAdapter {
  return {
    create(config, runtime, policy) {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: resolveEndpoint(options.baseURL, config),
        fetch: runtime.fetch
      })
      const modelID = config.customModelID.trim() || config.modelID
      if (options.openAIResponsesTools) {
        const providerTools: ProviderModelRuntime['providerTools'] = policy?.codeExecution?.enabled
          ? { code_interpreter: provider.tools.codeInterpreter() }
          : {}
        return compatibleRuntime(
          provider.responses(modelID),
          OPENAI_RESPONSES_CAPABILITIES,
          providerTools
        )
      }
      if (options.mode === 'chat') return compatibleRuntime(provider.chat(modelID))
      if (options.mode === 'configurable') {
        return compatibleRuntime(
          config.customAPIType === 'responses'
            ? provider.responses(modelID)
            : provider.chat(modelID)
        )
      }
      return compatibleRuntime(provider(modelID))
    }
  }
}

export function createAnthropicCompatibleAdapter(
  options: AnthropicCompatibleOptions = {}
): ModelProviderAdapter {
  return {
    create(config, runtime) {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL: resolveEndpoint(options.baseURL, config),
        fetch: runtime.fetch
      })
      return compatibleRuntime(provider(config.customModelID.trim() || config.modelID))
    }
  }
}
