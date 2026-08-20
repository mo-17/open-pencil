import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

import type { AIProviderID } from '@open-pencil/core/constants'

import {
  createAnthropicCompatibleAdapter,
  createOpenAICompatibleAdapter
} from '@/app/ai/providers/compatible'
import type {
  ModelProviderAdapter,
  ProviderCapabilityReport,
  ProviderModelRuntime
} from '@/app/ai/providers/types'

type DirectProviderID = Exclude<AIProviderID, `acp:${string}` | `harness:${string}`>

const DIRECT_CAPABILITIES: ProviderCapabilityReport = {
  functionTools: {
    state: 'supported',
    owner: 'application',
    evidence: 'adapter'
  },
  imageInput: { state: 'unknown', reason: 'Image input support depends on the selected model' },
  webSearch: { state: 'unsupported', reason: 'The provider adapter does not expose web search' },
  codeExecution: {
    state: 'unsupported',
    reason: 'The provider adapter does not expose code execution'
  },
  mcpTools: { state: 'unsupported', reason: 'The provider adapter does not expose MCP tools' }
}

const OPENROUTER_CAPABILITIES: ProviderCapabilityReport = {
  ...DIRECT_CAPABILITIES,
  webSearch: {
    state: 'supported',
    owner: 'gateway',
    api: 'chat',
    evidence: 'adapter'
  },
  codeExecution: {
    state: 'unsupported',
    reason: 'OpenRouter Shell requires a Responses API adapter'
  }
}

function directRuntime(model: ProviderModelRuntime['model']): ProviderModelRuntime {
  return {
    model,
    capabilities: DIRECT_CAPABILITIES,
    providerTools: {}
  }
}

const MODEL_PROVIDER_ADAPTERS = {
  openrouter: {
    create(config, runtime, policy) {
      const provider = createOpenRouter({
        apiKey: config.apiKey,
        fetch: runtime.fetch,
        compatibility: 'strict',
        headers: {
          'X-OpenRouter-Title': 'OpenPencil',
          'HTTP-Referer': 'https://github.com/open-pencil/open-pencil'
        }
      })
      const webSearch = policy?.webSearch
      const webSearchEnabled = webSearch?.enabled === true
      const providerTools: ProviderModelRuntime['providerTools'] = webSearchEnabled
        ? {
            web_search: provider.tools.webSearch({
              engine: webSearch.engine,
              maxResults: webSearch.maxResults
            })
          }
        : {}
      return {
        model: provider(config.customModelID.trim() || config.modelID, {
          provider: webSearchEnabled ? { require_parameters: true } : undefined
        }),
        capabilities: OPENROUTER_CAPABILITIES,
        providerTools
      }
    }
  },
  anthropic: createAnthropicCompatibleAdapter(),
  openai: createOpenAICompatibleAdapter({ openAIResponsesTools: true }),
  google: {
    create(config, runtime) {
      return directRuntime(
        createGoogleGenerativeAI({ apiKey: config.apiKey, fetch: runtime.fetch })(config.modelID)
      )
    }
  },
  deepseek: {
    create(config, runtime) {
      return directRuntime(
        createDeepSeek({ apiKey: config.apiKey, fetch: runtime.fetch })(config.modelID)
      )
    }
  },
  zai: createAnthropicCompatibleAdapter({ baseURL: 'https://api.z.ai/api/anthropic' }),
  minimax: createOpenAICompatibleAdapter({ baseURL: 'https://api.minimax.io/v1', mode: 'chat' }),
  'openai-compatible': createOpenAICompatibleAdapter({
    baseURL: (config) => config.customBaseURL,
    mode: 'configurable'
  }),
  'anthropic-compatible': createAnthropicCompatibleAdapter({
    baseURL: (config) => config.customBaseURL
  })
} satisfies Record<DirectProviderID, ModelProviderAdapter>

function isDirectProviderID(providerID: AIProviderID): providerID is DirectProviderID {
  return !providerID.startsWith('acp:') && providerID !== 'harness:pi'
}

export function modelProviderAdapter(providerID: AIProviderID): ModelProviderAdapter {
  if (!isDirectProviderID(providerID)) {
    throw new Error('ACP providers and Harness agents do not use direct API models')
  }
  return MODEL_PROVIDER_ADAPTERS[providerID]
}
