import type { UIMessage } from 'ai'
import { toRaw } from 'vue'

import {
  attachmentsForMessage,
  setMessageAttachments
} from '@/app/ai/attachment/presentation/store'
import { finalizePendingToolApprovals } from '@/app/ai/chat/approval'
import { archiveVisualChatMessages } from '@/app/ai/chat/attachments'
import { finalizeInterruptedToolParts } from '@/app/ai/chat/interruption'
import { visibleMessageText, setVisibleMessageText } from '@/app/ai/chat/presentation'
import { archiveAssistantFileMessages } from '@/app/ai/chat/sources'

import type { ConversationMessage } from './types'

/** Vue can wrap nested parts even when the message root was copied by history trimming. */
function snapshotValue<T>(value: T): T {
  const seen = new WeakMap<object, unknown>()
  function unwrap(input: unknown): unknown {
    if (typeof input !== 'object' || input === null) return input
    const raw = toRaw(input)
    const existing = seen.get(raw)
    if (existing) return existing
    if (Array.isArray(raw)) {
      const result: unknown[] = []
      seen.set(raw, result)
      for (const item of raw) result.push(unwrap(item))
      return result
    }
    const prototype = Object.getPrototypeOf(raw)
    if (prototype !== Object.prototype && prototype !== null) return raw
    const result: Record<string, unknown> = {}
    seen.set(raw, result)
    for (const [key, item] of Object.entries(raw)) {
      Object.defineProperty(result, key, {
        value: unwrap(item),
        enumerable: true,
        writable: true,
        configurable: true
      })
    }
    return result
  }
  return structuredClone(unwrap(value)) as T
}

export function snapshotMessages(messages: UIMessage[]): ConversationMessage[] {
  return archiveAssistantFileMessages(archiveVisualChatMessages(messages)).map((message) => {
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
    return {
      message: snapshotValue(message),
      displayText: visibleMessageText(message.id, text),
      attachments: attachmentsForMessage(message.id).value.map((attachment) =>
        snapshotValue(attachment)
      )
    }
  })
}

export function restoreMessages(messages: ConversationMessage[]): UIMessage[] {
  for (const row of messages) {
    if (row.displayText !== undefined) setVisibleMessageText(row.message.id, row.displayText)
    setMessageAttachments(row.message.id, row.attachments)
  }
  return finalizePendingToolApprovals(
    finalizeInterruptedToolParts(messages.map((row) => snapshotValue(row.message)))
  )
}

export function fallbackTitle(messages: UIMessage[]): string {
  const first = messages.find((message) => message.role === 'user')
  if (!first) return ''
  const text = first.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
  return visibleMessageText(first.id, text).replace(/\s+/g, ' ').trim().slice(0, 120)
}
