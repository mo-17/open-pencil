import { describe, expect, test } from 'bun:test'

import { createAIPopoutController, type AIPopoutView } from '@/app/ai-popout/controller'
import {
  installAIPopoutReceiver,
  requestAIPopoutLatestPayload,
  type AIPopoutGlobalTarget
} from '@/app/ai-popout/globals'
import { parseAIPopoutPayload } from '@/app/ai-popout/payload'
import { DEFAULT_AI_POPOUT_CONTROLS } from '@/app/ai/popout/controls'
import { AI_POPOUT_PROTOCOL_VERSION, type AIPopoutProjection } from '@/app/ai/popout/protocol'

function projection(overrides: Partial<AIPopoutProjection> = {}): AIPopoutProjection {
  return {
    protocolVersion: AI_POPOUT_PROTOCOL_VERSION,
    contextId: 'ai-context-1',
    documentName: 'Thrill Park',
    providerLabel: 'OpenAI',
    configured: true,
    status: 'ready',
    error: null,
    draft: '',
    canSubmit: true,
    canStop: false,
    canClear: true,
    canContinue: false,
    canRetry: false,
    messages: [
      {
        id: 'message-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Safe text </script> \u2028 stays data.' }]
      }
    ],
    ...overrides
  }
}

function base64(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function payload(revision: number, value = projection()) {
  return {
    envelope: base64(value),
    controls: DEFAULT_AI_POPOUT_CONTROLS,
    revision
  }
}

describe('AI popout native payload', () => {
  test('decodes the exact canonical envelope and validates the projection again', () => {
    expect(parseAIPopoutPayload(payload(1))).toEqual({
      projection: projection(),
      controls: DEFAULT_AI_POPOUT_CONTROLS,
      revision: 1
    })
  })

  test('rejects non-canonical envelopes, unknown fields, and invalid revisions', () => {
    const valid = payload(1)
    for (const value of [
      { ...valid, unexpected: true },
      { ...valid, revision: 0 },
      { ...valid, revision: 1.5 },
      { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, envelope: '' },
      { ...valid, envelope: 'e30' },
      { ...valid, envelope: base64([]) },
      { ...valid, envelope: btoa('not json') },
      { ...valid, controls: { toolbar: true } },
      { ...valid, controls: { ...DEFAULT_AI_POPOUT_CONTROLS, extra: true } },
      payload(1, { ...projection(), messages: [], unexpected: true } as AIPopoutProjection)
    ]) {
      expect(() => parseAIPopoutPayload(value)).toThrow()
    }
  })

  test('rejects invalid UTF-8 before parsing JSON', () => {
    expect(() =>
      parseAIPopoutPayload({
        ...payload(1),
        envelope: btoa(String.fromCharCode(0xff, 0xfe, 0xfd))
      })
    ).toThrow()
  })
})

describe('AI popout shell controller', () => {
  test('applies only strictly increasing revisions', () => {
    const applied: number[] = []
    const view: AIPopoutView = {
      apply(value) {
        applied.push(value.revision)
      }
    }
    const controller = createAIPopoutController(view)

    expect(controller.update(payload(2))).toBe(true)
    expect(controller.update(payload(1))).toBe(false)
    expect(controller.update(payload(2))).toBe(false)
    expect(controller.update(payload(3))).toBe(true)
    expect(applied).toEqual([2, 3])
    expect(controller.snapshot()?.revision).toBe(3)
  })

  test('does not advance state when parsing or rendering fails', () => {
    const controller = createAIPopoutController({
      apply() {
        throw new Error('view unavailable')
      }
    })
    expect(() => controller.update(payload(1))).toThrow('view unavailable')
    expect(controller.snapshot()).toBeNull()
    expect(() => controller.update({ ...payload(2), extra: true })).toThrow()
    expect(controller.snapshot()).toBeNull()
  })
})

describe('AI popout startup delivery', () => {
  test('installs before consuming initial, pending, and live payloads', () => {
    const revisions: number[] = []
    const target: AIPopoutGlobalTarget = {
      __OPENPENCIL_AI_POPOUT_INITIAL__: payload(1),
      __OPENPENCIL_AI_POPOUT_PENDING__: payload(2)
    }
    const dispose = installAIPopoutReceiver(target, (value) => {
      revisions.push(parseAIPopoutPayload(value).revision)
    })

    expect(revisions).toEqual([1, 2])
    expect('__OPENPENCIL_AI_POPOUT_INITIAL__' in target).toBe(false)
    expect('__OPENPENCIL_AI_POPOUT_PENDING__' in target).toBe(false)
    target.__OPENPENCIL_AI_POPOUT_UPDATE__?.(payload(3))
    expect(revisions).toEqual([1, 2, 3])
    dispose()
    expect(target.__OPENPENCIL_AI_POPOUT_UPDATE__).toBeUndefined()
  })

  test('does not let a delayed handshake replace a newer native update', async () => {
    const controller = createAIPopoutController({
      apply() {
        // Revision ordering is the behavior under test.
      }
    })
    let resolveLatest!: (value: unknown) => void
    const latest = new Promise<unknown>((resolve) => {
      resolveLatest = resolve
    })
    const handshake = requestAIPopoutLatestPayload(
      () => latest,
      (value) => void controller.update(value)
    )
    controller.update(payload(2))
    resolveLatest(payload(1))
    await handshake
    expect(controller.snapshot()?.revision).toBe(2)
  })
})

describe('AI popout document boundary', () => {
  test('uses a local, script-only wrapper without a second AI runtime', async () => {
    const [html, main] = await Promise.all([
      Bun.file('ai-popout.html').text(),
      Bun.file('src/app/ai-popout/main.ts').text()
    ])

    expect(html).toContain("default-src 'none'")
    expect(html).toContain("connect-src 'none'")
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('unsafe-inline')
    expect(main).toContain("invoke<unknown>('get_ai_window_latest_payload')")
    expect(main).toContain("invoke('send_ai_window_intent', { intent })")
    expect(main).toContain("invoke('focus_ai_editor_window')")
    expect(main).toContain("invoke('set_ai_window_always_on_top', { enabled })")
    expect(main.indexOf('installAIPopoutReceiver(')).toBeLessThan(
      main.indexOf("invoke<unknown>('get_ai_window_latest_payload')")
    )
    expect(main).not.toContain('innerHTML')
    expect(main).not.toContain('useAIChat')
    expect(main).not.toContain('ChatPanel')
    expect(main).not.toContain('credential')
    expect(main).not.toContain('localStorage')
    expect(main).not.toContain('__TAURI_INTERNALS__')
  })
})
