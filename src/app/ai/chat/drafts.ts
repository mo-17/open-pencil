import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import type { VisualChatAttachment } from '@/app/ai/chat/attachments'

type ChatOwner = object | null | undefined
type ChatOwnerSource = ChatOwner | (() => ChatOwner)

const drafts = new WeakMap<object, Ref<string>>()
const attachmentDrafts = new WeakMap<object, Ref<VisualChatAttachment[]>>()
const submissionLocks = new WeakMap<object, Ref<boolean>>()
const fallbackDraft = ref('')
const fallbackAttachmentDraft = ref<VisualChatAttachment[]>([])
const fallbackSubmissionLock = ref(false)

function getChatDraft(owner: ChatOwner): Ref<string> {
  if (!owner) return fallbackDraft

  const existing = drafts.get(owner)
  if (existing) return existing

  const draft = ref('')
  drafts.set(owner, draft)
  return draft
}

export function useChatDraft(owner: ChatOwner): Ref<string>
export function useChatDraft(owner: () => ChatOwner): Ref<string>
export function useChatDraft(owner: ChatOwnerSource): Ref<string> {
  if (typeof owner !== 'function') return getChatDraft(owner)

  return computed({
    get: () => getChatDraft(owner()).value,
    set: (value) => {
      getChatDraft(owner()).value = value
    }
  })
}

function getChatAttachments(owner: ChatOwner): Ref<VisualChatAttachment[]> {
  if (!owner) return fallbackAttachmentDraft

  const existing = attachmentDrafts.get(owner)
  if (existing) return existing

  const attachments = ref<VisualChatAttachment[]>([])
  attachmentDrafts.set(owner, attachments)
  return attachments
}

export function useChatAttachments(owner: ChatOwner): Ref<VisualChatAttachment[]>
export function useChatAttachments(owner: () => ChatOwner): Ref<VisualChatAttachment[]>
export function useChatAttachments(owner: ChatOwnerSource): Ref<VisualChatAttachment[]> {
  if (typeof owner !== 'function') return getChatAttachments(owner)

  return computed({
    get: () => getChatAttachments(owner()).value,
    set: (value) => {
      getChatAttachments(owner()).value = value
    }
  })
}

function getChatSubmissionPending(owner: ChatOwner): Ref<boolean> {
  if (!owner) return fallbackSubmissionLock

  const existing = submissionLocks.get(owner)
  if (existing) return existing

  const pending = ref(false)
  submissionLocks.set(owner, pending)
  return pending
}

export function useChatSubmissionPending(owner: ChatOwner): Ref<boolean>
export function useChatSubmissionPending(owner: () => ChatOwner): Ref<boolean>
export function useChatSubmissionPending(owner: ChatOwnerSource): Ref<boolean> {
  if (typeof owner !== 'function') return getChatSubmissionPending(owner)

  return computed({
    get: () => getChatSubmissionPending(owner()).value,
    set: (value) => {
      getChatSubmissionPending(owner()).value = value
    }
  })
}
