import { useStore } from '@nanostores/vue'
import { computed, ref, watch, type Ref } from 'vue'

import { buildDesignBrief } from '@open-pencil/core/tools'
import { locale as appLocale } from '@open-pencil/vue'

import { useChatDraft } from '@/app/ai/chat/drafts'
import { useAIChat } from '@/app/ai/chat/use'
import { getActiveEditorStore, useEditorStore } from '@/app/editor/active-store'
import { SYSTEM_CLIPBOARD_HOST } from '@/app/plugins/host/clipboard'

import { saveDesignBrief } from './files'
import {
  appendBriefToChat,
  composeDesignBrief,
  getDesignBriefDraft,
  isBriefCurrent,
  type BriefRevision,
  type BriefScope
} from './state'

type BriefFailure = 'generate' | 'copy' | 'save' | 'chat-limit' | null

export function useDesignBrief(open: Ref<boolean>) {
  const editor = useEditorStore()
  const locale = useStore(appLocale)
  const { activeTab } = useAIChat()
  const failure = ref<BriefFailure>(null)
  const pending = ref(false)
  const outcome = ref<'copied' | 'saved' | null>(null)
  const draft = computed(() => {
    // graph is a non-reactive getter; replacing a document advances sceneVersion.
    void editor.state.sceneVersion
    return getDesignBriefDraft(editor.graph, locale.value === 'zh-CN' ? 'zh-CN' : 'en')
  })
  const scope = computed<BriefScope>(() => {
    if (draft.value.scopeKind === 'document') return { kind: 'document' }
    if (draft.value.scopeKind === 'selection') {
      return { kind: 'selection', nodeIds: [...editor.state.selectedIds] }
    }
    return { kind: 'page', pageId: editor.state.currentPageId }
  })
  const revision = computed<BriefRevision>(() => ({
    scope: scope.value,
    sceneVersion: editor.state.sceneVersion,
    locale: draft.value.locale
  }))
  const current = computed(() => isBriefCurrent(draft.value.snapshot, revision.value))
  const markdown = computed(() => {
    const snapshot = draft.value.snapshot
    return snapshot
      ? composeDesignBrief(snapshot.result.markdown, draft.value.notes, snapshot.revision.locale)
      : ''
  })
  const result = computed(() => draft.value.snapshot?.result)

  function generate() {
    failure.value = null
    outcome.value = null
    const requestedRevision = revision.value
    const generated = buildDesignBrief(editor.graph, {
      scope: requestedRevision.scope,
      locale: requestedRevision.locale
    })
    if (!generated.ok) {
      failure.value = 'generate'
      draft.value.snapshot = null
      return
    }
    draft.value.snapshot = { result: generated, revision: requestedRevision }
  }

  async function transfer(kind: 'copy' | 'save') {
    if (!current.value || pending.value) return
    const graph = editor.graph
    const snapshot = draft.value.snapshot
    const text = markdown.value
    failure.value = null
    outcome.value = null
    pending.value = true
    try {
      const saved = kind === 'copy' ? await copyBrief(text) : await saveDesignBrief(text)
      if (
        editor.graph !== graph ||
        draft.value.snapshot !== snapshot ||
        markdown.value !== text ||
        !isBriefCurrent(draft.value.snapshot, revision.value)
      )
        return
      if (saved) outcome.value = kind === 'copy' ? 'copied' : 'saved'
    } catch {
      if (editor.graph === graph && draft.value.snapshot === snapshot) failure.value = kind
    } finally {
      pending.value = false
    }
  }

  function stageInChat(): boolean {
    if (!current.value || pending.value) return false
    const owner = getActiveEditorStore()
    const chatDraft = useChatDraft(owner)
    const appended = appendBriefToChat(chatDraft.value, markdown.value)
    if (appended === null) {
      failure.value = 'chat-limit'
      return false
    }
    chatDraft.value = appended
    activeTab.value = 'ai'
    owner.state.mobileDrawerSnap = 'full'
    open.value = false
    return true
  }

  watch(
    open,
    (visible) => {
      if (!visible) return
      failure.value = null
      outcome.value = null
      if (!draft.value.snapshot) generate()
    },
    { immediate: true }
  )
  watch([() => editor.graph, () => revision.value, () => draft.value.notes], () => {
    failure.value = null
    outcome.value = null
  })

  return {
    draft,
    result,
    current,
    markdown,
    generate,
    failure,
    pending,
    outcome,
    transfer,
    stageInChat
  }
}

async function copyBrief(text: string): Promise<boolean> {
  // This host reports actual write failure; the caller keeps the selectable text on screen.
  await SYSTEM_CLIPBOARD_HOST.writeText(text)
  return true
}
