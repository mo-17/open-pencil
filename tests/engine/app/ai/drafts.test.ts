import { describe, expect, test } from 'bun:test'

import { shallowRef } from 'vue'

import { useChatDraft, useChatSubmissionPending } from '@/app/ai/chat/drafts'

describe('chat drafts', () => {
  test('keeps one shared draft per editor store', () => {
    const storeA = {}
    const storeB = {}
    const originalView = useChatDraft(storeA)

    originalView.value = 'Restore this prompt'

    expect(useChatDraft(storeA)).toBe(originalView)
    expect(useChatDraft(storeA).value).toBe('Restore this prompt')
    expect(useChatDraft(storeB).value).toBe('')
  })

  test('shares the submission lock across remounts of the same editor store', () => {
    const store = {}
    const originalView = useChatSubmissionPending(store)

    originalView.value = true

    expect(useChatSubmissionPending(store)).toBe(originalView)
    expect(useChatSubmissionPending(store).value).toBe(true)
    expect(useChatSubmissionPending({}).value).toBe(false)
  })

  test('switches the draft ref value with a reactive editor store owner', () => {
    const storeA = {}
    const storeB = {}
    const activeStore = shallowRef<object | undefined>(storeA)
    const activeDraft = useChatDraft(() => activeStore.value)

    activeDraft.value = 'Draft A'
    activeStore.value = storeB
    expect(activeDraft.value).toBe('')

    activeDraft.value = 'Draft B'
    activeStore.value = storeA
    expect(activeDraft.value).toBe('Draft A')
    expect(useChatDraft(storeB).value).toBe('Draft B')
  })

  test('switches the submission lock with a reactive editor store owner', () => {
    const storeA = {}
    const storeB = {}
    const activeStore = shallowRef<object | undefined>(storeA)
    const activeLock = useChatSubmissionPending(() => activeStore.value)

    activeLock.value = true
    activeStore.value = storeB
    expect(activeLock.value).toBe(false)

    activeLock.value = true
    activeStore.value = storeA
    expect(activeLock.value).toBe(true)
    expect(useChatSubmissionPending(storeB).value).toBe(true)
  })
})
