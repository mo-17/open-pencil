import { expect, test } from 'bun:test'

import type { UIMessage } from 'ai'
import { reactive } from 'vue'

import { setMessageAttachments } from '@/app/ai/attachment/presentation/store'
import { restoreMessages, snapshotMessages } from '@/app/ai/chat/history/messages'

test('saved transcripts never restore permission to execute an unfinished tool', () => {
  const messages: UIMessage[] = [
    {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-write',
          toolCallId: 'pending',
          state: 'approval-requested',
          input: {},
          approval: { id: 'pending' }
        },
        {
          type: 'tool-write',
          toolCallId: 'approved',
          state: 'approval-responded',
          input: {},
          approval: { id: 'approved', approved: true }
        }
      ]
    }
  ]
  const snapshot = snapshotMessages(messages)
  const restored = restoreMessages(snapshot)
  expect(restored[0]?.parts[0]).toMatchObject({
    state: 'output-denied',
    approval: { approved: false }
  })
  expect(restored[0]?.parts[1]).toMatchObject({ state: 'output-error' })
  expect(snapshot[0]?.message.parts[0]).toMatchObject({ state: 'approval-requested' })
  expect(messages[0]?.parts[1]).toMatchObject({ state: 'approval-responded' })
})

test('snapshots detached message roots with nested reactive SDK parts', () => {
  const nested = reactive({
    parts: [{ type: 'text' as const, text: 'Saved reply' }],
    metadata: { status: 'complete' }
  })
  const snapshot = snapshotMessages([
    { id: 'nested', role: 'assistant', parts: nested.parts, metadata: nested.metadata }
  ])
  expect(snapshot[0]?.message.parts).toEqual([{ type: 'text', text: 'Saved reply' }])
  const first = nested.parts[0]
  if (!first) throw new Error('Missing reactive part')
  first.text = 'Later reply'
  expect(snapshot[0]?.message.parts[0]).toMatchObject({ text: 'Saved reply' })
})

test('snapshot keeps image preview blobs as portable data', () => {
  const id = 'image-blob-message'
  const preview = new Blob(['preview'], { type: 'image/png' })
  setMessageAttachments(id, [
    {
      id: 'image',
      messageId: id,
      kind: 'image',
      name: 'Reference',
      mediaType: 'image/png',
      preview,
      originalSize: { x: 100, y: 100 }
    }
  ])
  const snapshot = snapshotMessages([
    { id, role: 'user', parts: [{ type: 'text', text: 'Use this reference' }] }
  ])
  expect(snapshot[0]?.attachments[0]?.preview).toBeInstanceOf(Blob)
  expect(snapshot[0]?.attachments[0]?.preview.size).toBe(preview.size)
})
