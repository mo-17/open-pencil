import { describe, expect, test } from 'bun:test'

import { generateText, jsonSchema, tool } from 'ai'

import { createLanguageModel } from '@/app/ai/chat/model'
import { mergeAIToolSets } from '@/app/ai/chat/transports'
import { modelProviderAdapter } from '@/app/ai/providers/registry'
import type { ModelConfig, ProviderFeaturePolicy } from '@/app/ai/providers/types'

const OPENROUTER_CONFIG: ModelConfig = {
  providerID: 'openrouter',
  apiKey: 'test-key',
  modelID: 'anthropic/claude-sonnet-4.6',
  customModelID: '',
  customBaseURL: '',
  customAPIType: 'completions'
}

const OPENAI_CONFIG: ModelConfig = {
  providerID: 'openai',
  apiKey: 'test-key',
  modelID: 'gpt-5.4',
  customModelID: '',
  customBaseURL: '',
  customAPIType: 'responses'
}

type OpenRouterRequestBody = {
  model?: unknown
  provider?: unknown
  tools?: unknown
}

type OpenAIResponsesRequestBody = {
  model?: unknown
  include?: unknown
  tools?: unknown
}

function createOpenRouterRuntime(policy?: ProviderFeaturePolicy, fetcher?: typeof fetch) {
  return modelProviderAdapter('openrouter').create(OPENROUTER_CONFIG, { fetch: fetcher }, policy)
}

function createOpenAIRuntime(policy?: ProviderFeaturePolicy, fetcher?: typeof fetch) {
  return modelProviderAdapter('openai').create(OPENAI_CONFIG, { fetch: fetcher }, policy)
}

function openRouterSuccessResponse() {
  return new Response(
    JSON.stringify({
      id: 'generation-1',
      model: OPENROUTER_CONFIG.modelID,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'ok' }
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    }),
    { headers: { 'content-type': 'application/json' } }
  )
}

function openAIResponsesSuccessResponse() {
  return new Response(
    JSON.stringify({
      id: 'response-1',
      created_at: 1,
      model: OPENAI_CONFIG.modelID,
      output: [
        {
          type: 'message',
          role: 'assistant',
          id: 'message-1',
          content: [{ type: 'output_text', text: 'ok', annotations: [] }]
        }
      ],
      usage: {
        input_tokens: 1,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 0 }
      }
    }),
    { headers: { 'content-type': 'application/json' } }
  )
}

describe('provider model runtime', () => {
  test('keeps createLanguageModel compatible', () => {
    const model = createLanguageModel(OPENROUTER_CONFIG)

    expect(model.provider).toBe('openrouter')
    expect(model.modelId).toBe(OPENROUTER_CONFIG.modelID)
  })

  test('reports OpenRouter capabilities without enabling web search by default', () => {
    const runtime = createOpenRouterRuntime()

    expect(runtime.model.provider).toBe('openrouter')
    expect(runtime.capabilities.webSearch).toEqual({
      state: 'supported',
      owner: 'gateway',
      api: 'chat',
      evidence: 'adapter'
    })
    expect(runtime.providerTools).toEqual({})
    expect(runtime.providerOptions).toBeUndefined()
  })

  test('treats an explicitly disabled web search policy as disabled', () => {
    const runtime = createOpenRouterRuntime({ webSearch: { enabled: false } })

    expect(runtime.providerTools).toEqual({})
  })

  test('creates the installed OpenRouter provider web search tool when enabled', () => {
    const runtime = createOpenRouterRuntime({
      webSearch: { enabled: true, engine: 'exa', maxResults: 3 }
    })

    expect(runtime.providerTools.web_search).toMatchObject({
      type: 'provider',
      id: 'openrouter.web_search',
      args: { engine: 'exa', maxResults: 3 }
    })
  })

  test('serializes web search beside application tools without a paid API call', async () => {
    let requestBody: OpenRouterRequestBody | undefined
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
      requestBody = JSON.parse(init.body) as OpenRouterRequestBody
      return openRouterSuccessResponse()
    }) as typeof fetch
    const runtime = createOpenRouterRuntime(
      { webSearch: { enabled: true, engine: 'exa', maxResults: 3 } },
      fetcher
    )

    const result = await generateText({
      model: runtime.model,
      prompt: 'Find a current fact',
      tools: {
        ...runtime.providerTools,
        noop: tool({
          description: 'A test application tool',
          inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false })
        })
      }
    })

    expect(result.text).toBe('ok')
    expect(requestBody).toMatchObject({
      model: OPENROUTER_CONFIG.modelID,
      provider: { require_parameters: true },
      tools: [
        { type: 'openrouter:web_search', engine: 'exa', max_results: 3 },
        {
          type: 'function',
          function: {
            name: 'noop',
            description: 'A test application tool',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
          }
        }
      ]
    })
  })

  test('reports OpenAI Responses code execution without enabling it by default', () => {
    const runtime = createOpenAIRuntime()

    expect(runtime.model.provider).toBe('openai.responses')
    expect(runtime.capabilities.codeExecution).toEqual({
      state: 'supported',
      owner: 'provider',
      api: 'responses',
      evidence: 'adapter',
      constraints: { runtime: 'provider-hosted-python', container: 'auto' }
    })
    expect(runtime.providerTools).toEqual({})
    expect(createOpenAIRuntime({ codeExecution: { enabled: false } }).providerTools).toEqual({})
  })

  test('creates only the hosted OpenAI Code Interpreter tool when enabled', () => {
    const runtime = createOpenAIRuntime({ codeExecution: { enabled: true } })

    expect(runtime.providerTools.code_interpreter).toMatchObject({
      type: 'provider',
      id: 'openai.code_interpreter',
      args: {}
    })
  })

  test('does not expose Code Interpreter through an OpenAI-compatible endpoint', () => {
    const config: ModelConfig = {
      ...OPENAI_CONFIG,
      providerID: 'openai-compatible',
      customBaseURL: 'https://compatible.example/v1'
    }
    const runtime = modelProviderAdapter('openai-compatible').create(
      config,
      {},
      { codeExecution: { enabled: true } }
    )

    expect(runtime.capabilities.codeExecution.state).toBe('unsupported')
    expect(runtime.providerTools).toEqual({})
  })

  test('serializes an auto Code Interpreter container beside application tools', async () => {
    let requestURL: string | undefined
    let requestBody: OpenAIResponsesRequestBody | undefined
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestURL = input instanceof Request ? input.url : String(input)
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body')
      requestBody = JSON.parse(init.body) as OpenAIResponsesRequestBody
      return openAIResponsesSuccessResponse()
    }) as typeof fetch
    const runtime = createOpenAIRuntime({ codeExecution: { enabled: true } }, fetcher)

    const result = await generateText({
      model: runtime.model,
      prompt: 'Use Python to calculate a deterministic result',
      tools: {
        ...runtime.providerTools,
        noop: tool({
          description: 'A test application tool',
          inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false })
        })
      }
    })

    expect(result.text).toBe('ok')
    expect(requestURL).toBe('https://api.openai.com/v1/responses')
    expect(requestBody).toMatchObject({
      model: OPENAI_CONFIG.modelID,
      include: ['code_interpreter_call.outputs'],
      tools: [
        { type: 'code_interpreter', container: { type: 'auto' } },
        {
          type: 'function',
          name: 'noop',
          description: 'A test application tool',
          parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
      ]
    })
  })

  test('merges provider tools while rejecting ambiguous tool names', () => {
    const applicationTool = tool({
      description: 'Application tool',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false })
    })
    const providerTool = tool({
      description: 'Provider tool',
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false })
    })

    expect(
      mergeAIToolSets({ application_tool: applicationTool }, { web_search: providerTool })
    ).toEqual({
      application_tool: applicationTool,
      web_search: providerTool
    })
    expect(() =>
      mergeAIToolSets({ duplicate: applicationTool }, { duplicate: providerTool })
    ).toThrow('Provider tool name conflicts with an application tool: duplicate')
    expect(() => mergeAIToolSets({}, { create_module: providerTool })).toThrow(
      'Provider tool name conflicts with an application tool: create_module'
    )
  })
})
