import { describe, expect, test } from 'bun:test'

import {
  createPreviewEditorMessage,
  parsePreviewInboundMessage
} from '@/app/lowcode/preview-pane/iframe/messages'
import {
  appendRuntimeDebugEntries,
  parseRuntimeDebugBatch,
  type RuntimeDebugEntry
} from '@/app/lowcode/preview-pane/runtime-debug/protocol'
import { useRuntimeDebug } from '@/app/lowcode/preview-pane/runtime-debug/use'

const channel = 'runtime_debug_channel_123456'
function entry(sequence: number): RuntimeDebugEntry {
  return {
    sequence,
    trace: 1,
    nodeId: 'button',
    kind: 'action',
    label: 'setState',
    status: 'success',
    durationMs: null
  }
}

describe('preview runtime trace boundary', () => {
  test('accepts only metadata on the current preview channel', () => {
    const message = {
      source: 'op-lowcode-preview',
      channel,
      type: 'runtimeDebug',
      entries: [entry(1)],
      dropped: 0
    }
    expect(parsePreviewInboundMessage(message, channel)?.type).toBe('runtimeDebug')
    expect(parsePreviewInboundMessage(message, 'different_preview_channel_123')).toBeNull()
    expect(
      parseRuntimeDebugBatch({ entries: [{ ...entry(1), body: 'private' }], dropped: 0 })
    ).toBeNull()
    expect(
      parseRuntimeDebugBatch({
        entries: Array.from({ length: 33 }, (_, i) => entry(i)),
        dropped: 0
      })
    ).toBeNull()
    expect(createPreviewEditorMessage(channel, { type: 'runtimeDebug', enabled: true })).toEqual({
      source: 'op-lowcode-editor',
      channel,
      type: 'runtimeDebug',
      enabled: true
    })
  })

  test('retains at most 200 entries and ignores stale batches', () => {
    const first = Array.from({ length: 200 }, (_, i) => entry(i + 1))
    const next = appendRuntimeDebugEntries(first, [entry(199), entry(201), entry(202)])
    expect(next).toHaveLength(200)
    expect(next[0].sequence).toBe(3)
    expect(next.at(-1)?.sequence).toBe(202)
  })

  test('pause stops accepting entries; clear resets the runtime queue and closes safely', () => {
    const posted: unknown[] = []
    const debug = useRuntimeDebug((payload) => posted.push(payload))
    debug.toggle()
    debug.accept({ entries: [entry(1)], dropped: 0 })
    expect(debug.entries.value).toHaveLength(1)
    debug.setRecording(false)
    debug.accept({ entries: [entry(2)], dropped: 0 })
    expect(debug.entries.value).toHaveLength(1)
    debug.setRecording(true)
    debug.clear()
    expect(debug.entries.value).toHaveLength(0)
    expect(posted.at(-1)).toEqual({ type: 'runtimeDebug', enabled: true })
    debug.close()
    expect(debug.open.value).toBe(false)
    expect(posted.at(-1)).toEqual({ type: 'runtimeDebug', enabled: false })
  })
})
