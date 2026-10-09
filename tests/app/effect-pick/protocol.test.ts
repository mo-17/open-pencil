import { describe, expect, test } from 'bun:test'

import {
  EFFECT_PICK_PREVIEW_PROTOCOL,
  parseEffectPickPreviewMessage,
  parseEffectPickReadyEvent
} from '@/app/effect-pick/protocol'

const instanceId = '2c1f2099-bcf0-445d-a432-29d4c154cf50'
const message = (type: string) => ({ protocol: EFFECT_PICK_PREVIEW_PROTOCOL, instanceId, type })

describe('EffectPick private preview messages', () => {
  test('accepts only exact bounded instance and protocol envelopes', () => {
    expect(parseEffectPickPreviewMessage(message('click'), instanceId)?.type).toBe('click')
    for (const value of [
      { ...message('click'), payload: { action: 'setState' } },
      { ...message('click'), instanceId: crypto.randomUUID() },
      { ...message('click'), protocol: 'op-lowcode-preview' },
      message('navigate'),
      { ...message('error'), message: 'x'.repeat(501) },
      null
    ]) {
      expect(parseEffectPickPreviewMessage(value, instanceId)).toBeNull()
    }
  })

  test('requires opaque origin and the current iframe Window for the one-time handshake', () => {
    const source = {} as Window
    const ready = { source, origin: 'null', data: message('ready') }
    expect(parseEffectPickReadyEvent(ready, source, instanceId)?.type).toBe('ready')
    expect(parseEffectPickReadyEvent(ready, {} as Window, instanceId)).toBeNull()
    expect(
      parseEffectPickReadyEvent({ ...ready, origin: 'https://attacker.test' }, source, instanceId)
    ).toBeNull()
    expect(
      parseEffectPickReadyEvent({ ...ready, data: message('click') }, source, instanceId)
    ).toBeNull()
  })
})
