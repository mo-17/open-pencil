import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref } from 'vue'

import { SceneGraph } from '@open-pencil/scene-graph'

import { useChatDraft } from '@/app/ai/chat/drafts'
import { useAIChat } from '@/app/ai/chat/use'
import { useDesignBrief } from '@/app/design-brief/use'
import { getActiveEditorStoreOrNull, setActiveEditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session/create'

import { expectDefined } from '#tests/helpers/assert'

describe('design brief document lifecycle', () => {
  test('replacing the graph in the same editor selects its own draft and requires refresh', async () => {
    const previous = getActiveEditorStoreOrNull()
    const owner = createEditorStore()
    const scope = effectScope()
    setActiveEditorStore(owner)
    try {
      const firstGraph = owner.graph
      const firstPage = expectDefined(firstGraph.getPages()[0], 'first page')
      firstGraph.updateNode(firstPage.id, { name: 'Document A' })
      const state = expectDefined(
        scope.run(() => useDesignBrief(ref(true))),
        'brief state'
      )
      state.draft.value.notes = 'Document A private note'
      expect(state.current.value).toBe(true)
      expect(state.markdown.value).toContain('Document A private note')

      const secondGraph = new SceneGraph()
      const secondPage = expectDefined(secondGraph.getPages()[0], 'second page')
      secondGraph.updateNode(secondPage.id, { name: 'Document B' })
      owner.replaceGraph(secondGraph)
      await nextTick()
      expect(state.draft.value.notes).toBe('')
      expect(state.result.value).toBeUndefined()
      expect(state.markdown.value).toBe('')
      expect(state.current.value).toBe(false)
      expect(state.stageInChat()).toBe(false)

      state.generate()
      expect(state.current.value).toBe(true)
      expect(state.markdown.value).toContain('Document B')
      expect(state.markdown.value).not.toContain('Document A private note')
      state.draft.value.notes = 'Document B private note'
      owner.replaceGraph(firstGraph)
      await nextTick()
      expect(state.draft.value.notes).toBe('Document A private note')
      expect(state.current.value).toBe(false)
      state.generate()
      expect(state.markdown.value).toContain('Document A private note')
      expect(state.markdown.value).not.toContain('Document B private note')
    } finally {
      scope.stop()
      if (previous) setActiveEditorStore(previous)
      owner.dispose()
    }
  })

  test('switching editor owners never stages a previous document brief into the current chat', async () => {
    const previous = getActiveEditorStoreOrNull()
    const first = createEditorStore()
    const second = createEditorStore()
    const scope = effectScope()
    const activeChat = useAIChat().activeTab
    const previousTab = activeChat.value
    const open = ref(true)
    setActiveEditorStore(first)
    try {
      const state = expectDefined(
        scope.run(() => useDesignBrief(open)),
        'brief state'
      )
      state.draft.value.notes = 'First document only'
      const firstDraft = useChatDraft(first)
      const secondDraft = useChatDraft(second)
      firstDraft.value = 'Keep first draft'
      secondDraft.value = 'Keep second draft'

      setActiveEditorStore(second)
      await nextTick()
      expect(state.draft.value.notes).toBe('')
      expect(state.stageInChat()).toBe(false)
      expect(secondDraft.value).toBe('Keep second draft')
      state.generate()
      state.draft.value.notes = 'Second document only'
      expect(state.stageInChat()).toBe(true)
      expect(open.value).toBe(false)
      expect(activeChat.value).toBe('ai')
      expect(second.state.mobileDrawerSnap).toBe('full')
      expect(secondDraft.value).toStartWith('Keep second draft\n\n')
      expect(secondDraft.value).toContain('Second document only')
      expect(secondDraft.value).not.toContain('First document only')
      expect(firstDraft.value).toBe('Keep first draft')
    } finally {
      scope.stop()
      activeChat.value = previousTab
      if (previous) setActiveEditorStore(previous)
      first.dispose()
      second.dispose()
    }
  })
})
