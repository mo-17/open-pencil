import { afterEach, describe, expect, test } from 'bun:test'

import {
  AIPopoutHostIntentError,
  handleAIPopoutIntent,
  registerAIPopoutHost,
  subscribeAIPopoutHost,
  type AIPopoutHost
} from '@/app/ai/popout/host'
import {
  AI_POPOUT_LIMITS,
  AI_POPOUT_PROTOCOL_VERSION,
  parseAIPopoutIntent,
  parseAIPopoutProjection,
  type AIPopoutIntent,
  type AIPopoutProjection
} from '@/app/ai/popout/protocol'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function projection(contextId = 'context-a'): AIPopoutProjection {
  return {
    protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
    contextId,
    documentName: 'Document',
    providerLabel: 'Provider',
    configured: true,
    status: 'ready',
    error: null,
    draft: '',
    canSubmit: true,
    canStop: false,
    canContinue: false,
    canRetry: false,
    canClear: true,
    messages: [
      {
        id: 'message-1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Safe text' },
          {
            type: 'tool',
            name: 'Create shape',
            state: 'approval',
            summary: 'Approval is required in the editor.',
            approvalToken: null
          }
        ]
      }
    ]
  }
}

function intent(
  clientActionId: string,
  value: Omit<AIPopoutIntent, 'protocolVersion' | 'contextId' | 'clientActionId'> = {
    type: 'stop'
  }
): AIPopoutIntent {
  return {
    protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
    contextId: 'context-a',
    clientActionId,
    ...value
  } as AIPopoutIntent
}

function register(host: AIPopoutHost): void {
  cleanups.push(registerAIPopoutHost(host))
}

describe('AI popout protocol', () => {
  test('accepts only the bounded projection allowlist', () => {
    expect(parseAIPopoutProjection(projection())).toEqual(projection())

    const withMetadata = { ...projection(), metadata: { credential: 'secret' } }
    expect(() => parseAIPopoutProjection(withMetadata)).toThrow('unsupported or missing fields')

    const originalMessage = projection().messages[0]
    const originalTool = originalMessage.parts[1]
    const withRawToolInput = {
      ...projection(),
      messages: [
        {
          ...originalMessage,
          parts: [originalMessage.parts[0], { ...originalTool, rawInput: { token: 'secret' } }]
        }
      ]
    }
    expect(() => parseAIPopoutProjection(withRawToolInput)).toThrow('unsupported or missing fields')

    const withExecutableApproval = structuredClone(projection())
    const projectedTool = withExecutableApproval.messages[0].parts[1]
    if (projectedTool.type !== 'tool') throw new Error('Expected tool fixture')
    ;(projectedTool as { approvalToken: string | null }).approvalToken = 'executable-token'
    expect(() => parseAIPopoutProjection(withExecutableApproval)).toThrow(
      'tool approval is available only in the editor'
    )
  })

  test('rejects oversized text, message lists, and projection bytes', () => {
    const oversizedText = structuredClone(projection())
    const textPart = oversizedText.messages[0].parts[0]
    if (textPart.type !== 'text') throw new Error('Expected text fixture')
    ;(textPart as { text: string }).text = 'x'.repeat(AI_POPOUT_LIMITS.textChars + 1)
    expect(() => parseAIPopoutProjection(oversizedText)).toThrow('bounded string')

    const tooManyMessages = {
      ...projection(),
      messages: Array.from({ length: AI_POPOUT_LIMITS.messages + 1 }, (_, index) => ({
        id: `message-${index}`,
        role: 'user' as const,
        parts: []
      }))
    }
    expect(() => parseAIPopoutProjection(tooManyMessages)).toThrow('too many messages')

    const oversizedProjection = {
      ...projection(),
      messages: [
        {
          id: 'oversized-message',
          role: 'assistant' as const,
          parts: Array.from({ length: 3 }, () => ({
            type: 'text' as const,
            text: '界'.repeat(AI_POPOUT_LIMITS.textChars)
          }))
        }
      ]
    }
    expect(() => parseAIPopoutProjection(oversizedProjection)).toThrow('byte limit')
  })

  test('parses exact intents and rejects payload smuggling', () => {
    expect(
      parseAIPopoutIntent({
        protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
        contextId: 'context-a',
        clientActionId: 'action-a',
        type: 'submit',
        text: 'Create a card'
      })
    ).toEqual({
      protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
      contextId: 'context-a',
      clientActionId: 'action-a',
      type: 'submit',
      text: 'Create a card'
    })
    expect(() =>
      parseAIPopoutIntent({
        ...intent('action-b'),
        credential: 'secret'
      })
    ).toThrow('unsupported or missing fields')
    expect(() =>
      parseAIPopoutIntent({
        protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
        contextId: 'context-a',
        clientActionId: 'x'.repeat(AI_POPOUT_LIMITS.actionIdChars + 1),
        type: 'clear'
      })
    ).toThrow('bounded string')

    const openSettings = {
      protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
      contextId: 'context-a',
      clientActionId: 'settings-a',
      type: 'openSettings'
    } as const
    expect(parseAIPopoutIntent(openSettings)).toEqual(openSettings)
    expect(() =>
      parseAIPopoutIntent({
        ...openSettings,
        section: 'credentials'
      })
    ).toThrow('unsupported or missing fields')
  })
})

describe('AI popout host', () => {
  test('dispatches the exact settings intent through the current host only', async () => {
    const handled: AIPopoutIntent[] = []
    register({
      getProjection: () => projection(),
      async handleIntent(value) {
        handled.push(value)
      },
      subscribe: () => () => undefined
    })

    const openSettings = intent('settings-a', { type: 'openSettings' })
    expect(await handleAIPopoutIntent(openSettings)).toMatchObject({
      ok: true,
      duplicate: false
    })
    expect(handled).toEqual([openSettings])

    expect(
      await handleAIPopoutIntent({
        ...openSettings,
        clientActionId: 'settings-stale',
        contextId: 'other-context'
      })
    ).toMatchObject({ ok: false, code: 'stale-context' })
    expect(handled).toEqual([openSettings])
  })

  test('executes a client action at most once and rejects action-id payload changes', async () => {
    let calls = 0
    register({
      getProjection: () => projection(),
      async handleIntent() {
        calls++
      },
      subscribe: () => () => undefined
    })

    const first = await handleAIPopoutIntent(intent('action-a'))
    const duplicate = await handleAIPopoutIntent(intent('action-a'))
    const changed = await handleAIPopoutIntent(
      intent('action-a', { type: 'submit', text: 'Different action' })
    )

    expect(first).toMatchObject({ ok: true, duplicate: false })
    expect(duplicate).toMatchObject({ ok: true, duplicate: true })
    expect(changed).toMatchObject({ ok: false, code: 'invalid' })
    expect(calls).toBe(1)
  })

  test('fails closed for stale context and preserves a bounded host error', async () => {
    register({
      getProjection: () => projection(),
      async handleIntent() {
        throw new AIPopoutHostIntentError('unsupported', 'No longer available')
      },
      subscribe: () => () => undefined
    })

    expect(
      await handleAIPopoutIntent({ ...intent('stale'), contextId: 'old-context' })
    ).toMatchObject({ ok: false, code: 'stale-context' })
    expect(await handleAIPopoutIntent(intent('unsupported'))).toMatchObject({
      ok: false,
      code: 'unsupported',
      message: 'No longer available'
    })
  })

  test('never dispatches detached-window approvals across active or stale contexts', async () => {
    let calls = 0
    register({
      getProjection: () => projection(),
      async handleIntent() {
        calls++
      },
      subscribe: () => () => undefined
    })

    const approval = intent('approval-active', {
      type: 'toolApproval',
      approvalToken: 'untrusted-token',
      approved: true
    })
    const active = await handleAIPopoutIntent(approval)
    const stale = await handleAIPopoutIntent({
      ...approval,
      contextId: 'other-tab-or-provider',
      clientActionId: 'approval-stale',
      approved: false
    })

    expect(active).toMatchObject({ ok: false, code: 'unsupported' })
    expect(stale).toMatchObject({ ok: false, code: 'unsupported' })
    expect(calls).toBe(0)
  })

  test('publishes projections without exposing the mutable host object', async () => {
    let notify = () => undefined
    let current = projection()
    register({
      getProjection: () => current,
      async handleIntent() {
        return undefined
      },
      subscribe(listener) {
        notify = listener
        return () => undefined
      }
    })
    let receivedDraft: string | undefined
    let receivedCurrentObject = false
    cleanups.push(
      subscribeAIPopoutHost((value) => {
        receivedDraft = value?.draft
        receivedCurrentObject = value === current
      })
    )

    current = { ...current, draft: 'Next draft' }
    notify()
    await Promise.resolve()

    expect(receivedDraft).toBe('Next draft')
    expect(receivedCurrentObject).toBe(false)
  })
})
