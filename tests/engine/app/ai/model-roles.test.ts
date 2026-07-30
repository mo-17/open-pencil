import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { UIMessage, UIMessageChunk } from 'ai'
import { computed, effectScope, ref } from 'vue'

import type { AIProviderID } from '@open-pencil/core/constants'

import { registerAIChatEffects } from '@/app/ai/chat/storage'
import { createChatSessionManager } from '@/app/ai/chat/transports'
import {
  createAIModelRuntime,
  createModelProfileDraft,
  modelCredentialRevision,
  modelSettingsSnapshot,
  parseAIModelSettings,
  removeModelProfile,
  removeRemoteMcpServerFromModelProfiles,
  replaceAIModelSettings,
  resolveAIModelRole,
  saveModelProfileDraft,
  setModelConnectionAPIKey,
  setModelRoleAssignment,
  type AIModelSettings
} from '@/app/ai/models'
import { appCredentialRefs } from '@/app/settings/credentials/persistence'
import { credentialKey } from '@/app/settings/credentials/reference'

let original: AIModelSettings

function settingsFixture(): AIModelSettings {
  return {
    version: 2,
    connections: [
      {
        id: 'connection-anthropic',
        providerID: 'anthropic',
        customBaseURL: '',
        customAPIType: 'completions',
        credentialProfileId: 'anthropic-main'
      },
      {
        id: 'connection-google',
        providerID: 'google',
        customBaseURL: '',
        customAPIType: 'completions',
        credentialProfileId: 'google-main'
      }
    ],
    models: [
      {
        id: 'model-design',
        name: 'Design model',
        connectionId: 'connection-anthropic',
        modelID: 'claude-sonnet-4-6-20260301',
        customModelID: '',
        maxOutputTokens: 16_384,
        capabilities: ['tools', 'vision'],
        featurePolicy: {
          webSearch: { enabled: false },
          codeExecution: { enabled: false },
          mcpServerIds: []
        }
      },
      {
        id: 'model-fast',
        name: 'Fast model',
        connectionId: 'connection-google',
        modelID: 'gemini-3-flash-preview',
        customModelID: '',
        maxOutputTokens: 8192,
        capabilities: ['tools'],
        featurePolicy: {
          webSearch: { enabled: false },
          codeExecution: { enabled: false },
          mcpServerIds: []
        }
      }
    ],
    assignments: {
      design: 'model-design',
      review: 'design',
      fast: 'model-fast',
      vision: 'design'
    }
  }
}

function omitFeaturePolicy({ featurePolicy: _, ...profile }: AIModelSettings['models'][number]) {
  return profile
}

beforeEach(() => {
  original = modelSettingsSnapshot()
  replaceAIModelSettings(settingsFixture())
})

afterEach(() => {
  replaceAIModelSettings(original)
})

describe('AI model profiles and role assignments', () => {
  test('resolves inherited and independent assignments', () => {
    expect(resolveAIModelRole('review')).toMatchObject({
      requestedRole: 'review',
      profile: { id: 'model-design' },
      connection: { id: 'connection-anthropic' }
    })
    expect(resolveAIModelRole('fast')).toMatchObject({
      requestedRole: 'fast',
      profile: { id: 'model-fast' },
      connection: { id: 'connection-google' }
    })
  })

  test('enforces role capability requirements', () => {
    setModelRoleAssignment('design', 'model-fast')
    expect(resolveAIModelRole('design')?.profile.id).toBe('model-fast')

    setModelRoleAssignment('vision', 'model-fast')
    expect(resolveAIModelRole('vision')).toBeNull()

    setModelRoleAssignment('vision', null)
    expect(resolveAIModelRole('vision')).toBeNull()
  })

  test('reuses matching provider connections when adding models', () => {
    const draft = createModelProfileDraft()
    draft.name = 'Review model'
    draft.providerID = 'anthropic'
    draft.modelID = 'claude-opus-4-6-20260301'
    draft.sourceConnectionId = null

    const profile = saveModelProfileDraft(draft)
    expect(profile.connectionId).toBe('connection-anthropic')
    expect(modelSettingsSnapshot().connections).toHaveLength(2)
  })

  test('keeps ACP agents exclusive to the Design role', () => {
    const settings = modelSettingsSnapshot()
    settings.connections.push({
      id: 'connection-acp',
      providerID: 'acp:claude-code',
      customBaseURL: '',
      customAPIType: 'completions',
      credentialProfileId: 'connection-acp'
    })
    settings.models.push({
      id: 'model-acp',
      name: 'Claude Code',
      connectionId: 'connection-acp',
      modelID: '',
      customModelID: '',
      maxOutputTokens: 16_384,
      capabilities: ['tools'],
      featurePolicy: {
        webSearch: { enabled: false },
        codeExecution: { enabled: false },
        mcpServerIds: []
      }
    })
    replaceAIModelSettings(settings)

    setModelRoleAssignment('review', null)
    setModelRoleAssignment('review', 'model-acp')
    expect(resolveAIModelRole('review')).toBeNull()

    setModelRoleAssignment('design', 'model-acp')
    expect(resolveAIModelRole('design')?.profile.id).toBe('model-acp')
    setModelRoleAssignment('fast', null)
    setModelRoleAssignment('fast', 'design')
    expect(resolveAIModelRole('fast')).toBeNull()
  })

  test('normalizes invalid output limits before persistence', () => {
    const draft = createModelProfileDraft('model-fast')
    draft.maxOutputTokens = Number.NaN
    expect(saveModelProfileDraft(draft).maxOutputTokens).toBe(16_384)
  })

  test('migrates v1 profiles with every optional feature disabled', () => {
    const settings = settingsFixture()
    const legacy = {
      ...settings,
      version: 1,
      models: [
        {
          ...omitFeaturePolicy(settings.models[0]),
          featurePolicy: {
            webSearch: { enabled: true },
            codeExecution: { enabled: true },
            mcpServerIds: ['mcp-untrusted-forward-field']
          }
        },
        omitFeaturePolicy(settings.models[1])
      ]
    }

    const migrated = parseAIModelSettings(legacy)
    expect(migrated?.version).toBe(2)
    expect(migrated?.models.map((model) => model.featurePolicy)).toEqual([
      {
        webSearch: { enabled: false },
        codeExecution: { enabled: false },
        mcpServerIds: []
      },
      {
        webSearch: { enabled: false },
        codeExecution: { enabled: false },
        mcpServerIds: []
      }
    ])
  })

  test('preserves enabled feature policy without sharing nested arrays', () => {
    const draft = createModelProfileDraft('model-fast')
    draft.featurePolicy.webSearch.enabled = true
    draft.featurePolicy.mcpServerIds.push('docs')

    const profile = saveModelProfileDraft(draft)
    draft.featurePolicy.mcpServerIds.push('private')

    expect(profile.featurePolicy).toEqual({
      webSearch: { enabled: true },
      codeExecution: { enabled: false },
      mcpServerIds: ['docs']
    })
  })

  test('bounds persisted remote MCP IDs and removes deleted server assignments', () => {
    const settings = settingsFixture()
    const serverIds = Array.from(
      { length: 10 },
      (_, index) => `mcp-${(index + 1).toString(16).padStart(16, '0')}`
    )
    settings.models[0].featurePolicy = {
      webSearch: { enabled: false },
      codeExecution: { enabled: false },
      mcpServerIds: [serverIds[0], 'not-a-server', serverIds[0], ...serverIds.slice(1)]
    }

    const parsed = parseAIModelSettings(settings)
    expect(parsed?.models[0].featurePolicy.mcpServerIds).toEqual(serverIds.slice(0, 8))
    if (!parsed) throw new Error('Expected parsed settings')
    replaceAIModelSettings(parsed)
    expect(removeRemoteMcpServerFromModelProfiles(serverIds[0])).toBe(1)
    expect(modelSettingsSnapshot().models[0].featurePolicy.mcpServerIds).toEqual(
      serverIds.slice(1, 8)
    )
  })

  test('repairs assignments when removing a model', () => {
    removeModelProfile('model-design')
    const settings = modelSettingsSnapshot()
    expect(settings.assignments.design).toBe('model-fast')
    expect(settings.assignments.vision).toBeNull()
    expect(settings.connections.map((connection) => connection.id)).toEqual(['connection-google'])
  })

  test('includes configured connection credentials in persistence changes', () => {
    const keys = appCredentialRefs().map(credentialKey)
    expect(keys).toContain('v1:anthropic:anthropic-main:api-key')
    expect(keys).toContain('v1:google:google-main:api-key')
  })

  test('invalidates chat synchronously when a model connection credential changes', async () => {
    const scope = effectScope()
    const store = {} as EditorStore
    let invalidations = 0
    let staleTransportSends = 0
    const manager = createChatSessionManager({
      isConfigured: computed(() => true),
      isACPProvider: computed(() => false),
      providerID: ref<AIProviderID>('anthropic'),
      credentialsReady: Promise.resolve(),
      getActiveEditorStore: () => store
    })
    manager.setOverrideTransport(() => ({
      async sendMessages() {
        staleTransportSends += 1
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.close()
          }
        })
      },
      reconnectToStream: async () => null
    }))
    const staleChat = await manager.ensureChat()
    if (!staleChat) throw new Error('Missing stale chat')
    staleChat.messages = [
      {
        id: 'assistant-approval',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'write',
            toolCallId: 'call-approval',
            state: 'approval-requested',
            input: { value: 'old runtime' },
            approval: { id: 'approval-1' }
          }
        ]
      } satisfies UIMessage
    ]
    const previousRevision = modelCredentialRevision.value
    const previousSessionRevision = manager.sessionRevision.value
    scope.run(() =>
      registerAIChatEffects(() => {
        invalidations++
        manager.markTransportDirty()
      })
    )

    try {
      await setModelConnectionAPIKey('connection-anthropic', 'replacement-secret')
      expect(modelCredentialRevision.value).toBe(previousRevision + 1)
      expect(invalidations).toBe(1)
      expect(manager.sessionRevision.value).toBe(previousSessionRevision + 1)
      expect(
        await manager.respondToToolApproval(staleChat, 'assistant-approval', 'approval-1', true)
      ).toBeFalse()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      expect(staleTransportSends).toBe(0)
    } finally {
      scope.stop()
      await manager.resetChat()
      await setModelConnectionAPIKey('connection-anthropic', '')
    }
  })

  test('creates a role runtime without exposing its resolved credential', async () => {
    await setModelConnectionAPIKey('connection-anthropic', 'review-secret')
    try {
      const runtime = await createAIModelRuntime('review')
      expect(runtime?.kind).toBe('direct')
      expect(runtime?.role.profile.id).toBe('model-design')
      expect(runtime).not.toHaveProperty('apiKey')
    } finally {
      await setModelConnectionAPIKey('connection-anthropic', '')
    }
  })

  test('maps enabled web search into the provider runtime', async () => {
    const settings = modelSettingsSnapshot()
    settings.connections[0].providerID = 'openrouter'
    settings.models[0].featurePolicy.webSearch.enabled = true
    replaceAIModelSettings(settings)

    await setModelConnectionAPIKey('connection-anthropic', 'openrouter-secret')
    try {
      const runtime = await createAIModelRuntime('design')
      expect(runtime?.kind).toBe('direct')
      if (runtime?.kind !== 'direct') throw new Error('Expected a direct model runtime')
      expect(runtime.providerTools.web_search).toMatchObject({
        type: 'provider',
        id: 'openrouter.web_search'
      })
    } finally {
      await setModelConnectionAPIKey('connection-anthropic', '')
    }
  })

  test('fails fast when web search is enabled on an unsupported adapter', async () => {
    const settings = modelSettingsSnapshot()
    settings.models[1].featurePolicy.webSearch.enabled = true
    replaceAIModelSettings(settings)

    await setModelConnectionAPIKey('connection-google', 'google-secret')
    try {
      expect(createAIModelRuntime('fast')).rejects.toThrow(
        'Web search is not supported by the google provider adapter'
      )
    } finally {
      await setModelConnectionAPIKey('connection-google', '')
    }
  })

  test('maps provider-hosted code execution only into the direct OpenAI runtime', async () => {
    const settings = modelSettingsSnapshot()
    settings.connections[0].providerID = 'openai'
    settings.models[0].featurePolicy.codeExecution.enabled = true
    replaceAIModelSettings(settings)

    await setModelConnectionAPIKey('connection-anthropic', 'openai-secret')
    try {
      const runtime = await createAIModelRuntime('design')
      if (runtime?.kind !== 'direct') throw new Error('Expected a direct model runtime')
      expect(runtime.providerTools.code_interpreter).toMatchObject({
        type: 'provider',
        id: 'openai.code_interpreter'
      })
    } finally {
      await setModelConnectionAPIKey('connection-anthropic', '')
    }

    const unsupportedSettings = settingsFixture()
    unsupportedSettings.models[1].featurePolicy.codeExecution.enabled = true
    replaceAIModelSettings(unsupportedSettings)
    await setModelConnectionAPIKey('connection-google', 'google-secret')
    try {
      expect(createAIModelRuntime('fast')).rejects.toThrow(
        'Code execution is not supported by the google provider adapter'
      )
    } finally {
      await setModelConnectionAPIKey('connection-google', '')
    }
  })
})
