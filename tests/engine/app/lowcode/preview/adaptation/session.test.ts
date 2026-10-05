import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref } from 'vue'

import { usePreviewAdaptation } from '@/app/lowcode/preview-pane/adaptation/session'
import type {
  PreviewEditorPayload,
  PreviewTextScale
} from '@/app/lowcode/preview-pane/iframe/messages'

function session() {
  const scope = effectScope()
  const enabled = ref(true)
  const textScale = ref<PreviewTextScale>(1)
  const context = ref<string | null>('channel-a:page-a')
  const viewport = ref('390x844')
  const posted: PreviewEditorPayload[] = []
  const state = scope.run(() =>
    usePreviewAdaptation({
      enabled,
      textScale,
      context,
      viewport,
      post: (message) => posted.push(message)
    })
  )
  if (!state) throw new Error('Adaptation session did not initialize')
  const response = (revision = state.revision.value) => ({
    source: 'op-lowcode-preview' as const,
    channel: 'channel-a',
    type: 'adaptation' as const,
    revision,
    items: [{ nodeId: 'node-a', kind: 'text-clipping' as const }],
    truncated: false
  })
  return { scope, enabled, textScale, context, viewport, posted, state, response }
}

describe('adaptation preview lifetime', () => {
  test('rejects results immediately after settings change and clears stale items', async () => {
    const s = session()
    try {
      expect(s.state.accept(s.response())).toBe(true)
      const oldRevision = s.state.revision.value
      s.textScale.value = 2
      expect(s.state.accept(s.response(oldRevision))).toBe(false)
      await nextTick()
      expect(s.state.items.value).toEqual([])
      expect(s.state.waiting.value).toBe(true)
      expect(s.posted.at(-1)).toMatchObject({ textScale: 2, diagnostics: true })
      expect(s.state.accept(s.response(oldRevision))).toBe(false)
      expect(s.state.accept(s.response())).toBe(true)
    } finally {
      s.scope.stop()
    }
  })

  test('invalidates page/frame changes, unavailable preview and disabled inspection', async () => {
    const s = session()
    try {
      const old = s.response()
      s.context.value = 'channel-b:page-b'
      expect(s.state.accept(old)).toBe(false)
      await nextTick()
      expect(s.state.accept(old)).toBe(false)
      const next = s.response()
      s.enabled.value = false
      expect(s.state.accept(next)).toBe(false)
      await nextTick()
      expect(s.state.waiting.value).toBe(false)
      expect(s.posted.at(-1)).toMatchObject({ diagnostics: false })
      s.context.value = null
      const count = s.posted.length
      await nextTick()
      expect(s.posted).toHaveLength(count + 1)
      expect(s.posted.at(-1)).toMatchObject({ textScale: 1, diagnostics: false })
      expect(s.state.items.value).toEqual([])
    } finally {
      s.scope.stop()
    }
  })

  test('coalesces continuous resizing and restores dev simulation on disposal', async () => {
    const s = session()
    s.viewport.value = '320x844'
    s.viewport.value = '360x844'
    s.viewport.value = '768x844'
    await nextTick()
    expect(s.posted).toHaveLength(2)
    const late = s.response()
    s.scope.stop()
    expect(s.posted.at(-1)).toMatchObject({ textScale: 1, diagnostics: false })
    expect(s.state.accept(late)).toBe(false)
    const count = s.posted.length
    s.state.request()
    expect(s.posted).toHaveLength(count)
  })
})
