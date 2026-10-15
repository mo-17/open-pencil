/** Browser fixture for public chat ownership, actual SDK acceptance and delayed image contracts. */
import { watch } from 'vue'

import { SceneGraph } from '@open-pencil/scene-graph'

import { useChatAttachments, useChatDraft, useChatSubmissionPending } from '@/app/ai/chat/drafts'
import { chatDocumentId } from '@/app/ai/chat/history/document'
import { createConversationStore } from '@/app/ai/chat/history/idb'
import { createToolLoopTransport } from '@/app/ai/chat/transports'
import { useAIChat } from '@/app/ai/chat/use'
import { chatPanelController as host } from '@/app/ai/popout/chat-host-controller'
import { getAIPopoutProjection, handleAIPopoutIntent } from '@/app/ai/popout/host'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import type { EditorPreparationHandle, EditorPreparationKind } from '@/app/editor/preparation/types'
import { createEditorStore } from '@/app/editor/session/create'
import { activeTab, createTab, switchTab, closeTab } from '@/app/tabs'

import { createRenderStreamModel } from '../render-stream/model'

export function createChatOwnerFixture() {
  const ai = useAIChat()
  const ordinals = new WeakMap<object, number>()
  let nextOrdinal = 0
  const ordinal = (value: object | undefined) => {
    if (!value) return null
    const existing = ordinals.get(value)
    if (existing) return existing
    const id = ++nextOrdinal
    ordinals.set(value, id)
    return id
  }
  const originalTabId = activeTab.value?.id
  const addedTabIds: string[] = []
  const handles = new Map<string, EditorPreparationHandle>()
  const cleanups: Array<() => void> = []
  const jobs: Promise<unknown>[] = []

  function snapshot() {
    const tab = activeTab.value
    return {
      tabId: tab?.id ?? null,
      graph: ordinal(tab?.store.graph),
      documentId: tab ? chatDocumentId(tab.store) : null,
      preparation: tab?.store.state.preparation ? { ...tab.store.state.preparation } : null,
      historyId: ai.history.current.value?.id ?? null,
      historyDocument: ai.history.current.value?.documentId ?? null,
      readOnly: ai.history.readOnly.value,
      historyBusy: ai.history.busy.value,
      status: host.status.value,
      pending: host.submissionPending.value,
      attachmentBusy: host.attachmentBusy.value,
      messages: host.messages.value.map((m) => ({ id: m.id, role: m.role })),
      projection: getAIPopoutProjection()
    }
  }
  function prepare(kind: EditorPreparationKind) {
    const store = activeTab.value?.store
    if (!store) throw new Error('No active editor')
    const handle = store.preparationController.begin({ kind, phase: 'resolving-fonts' })
    const key = crypto.randomUUID()
    handles.set(key, handle)

    return key
  }
  function settle(key: string) {
    const handle = handles.get(key)
    if (!handle) throw new Error('Unknown public preparation handle')
    handle.update({ phase: 'layout' })
    handle.complete()
    handles.delete(key)
  }
  function newOwnerPreparing(kind: 'page-switch' | 'font-retry') {
    const store = createEditorStore()
    store.setDocumentSource('new-owner.fig', 'fig', undefined, '/chat-owner-fixture/new-owner.fig')
    const handle = store.preparationController.begin({ kind, phase: 'resolving-fonts' })
    const key = crypto.randomUUID()
    handles.set(key, handle)
    const tab = createTab(store)
    addedTabIds.push(tab.id)

    return { key, tabId: tab.id, documentId: chatDocumentId(store), preparationId: handle.id }
  }
  function newOwner() {
    const tab = createTab()
    addedTabIds.push(tab.id)

    return tab.id
  }

  function installHeldRender() {
    const store = activeTab.value?.store
    const setTransport = window.openPencil?.setChatTransport
    if (!store || !setTransport) throw new Error('Existing transport boundary unavailable')
    const scenario = createRenderStreamModel({
      jsx: '<Frame name="Late owner Card" w={120} h={80}><Text>Held owner</Text></Frame>',
      placement: { x: 40, y: 40 },
      pauseAfter: ['Held owner']
    })
    const stats = { connections: 0, requests: 0, aborts: 0 }
    setTransport(() => {
      stats.connections++
      const transport = createToolLoopTransport({
        store,
        model: scenario.model,
        providerID: 'openrouter',
        effectiveModelID: 'held-render-fixture',
        maxOutputTokens: 2048,
        thinkingLevel: () => 'default'
      })
      return {
        sendMessages(options) {
          stats.requests++
          const signal = options.abortSignal
          const aborted = () => {
            stats.aborts++
          }
          if (signal?.aborted) aborted()
          else if (signal) {
            signal.addEventListener('abort', aborted, { once: true })
            cleanups.push(() => signal.removeEventListener('abort', aborted))
          }

          return transport.sendMessages(options)
        },
        reconnectToStream: (options) => transport.reconnectToStream(options)
      }
    })
    cleanups.push(scenario.dispose)
    return { ready: scenario.ready, complete: scenario.complete, stats: () => ({ ...stats }) }
  }

  async function startSamePathReplacement(newSource = false) {
    const store = activeTab.value?.store
    if (!store) throw new Error('No active editor')
    const oldGraph = ordinal(store.graph)
    const documentId = chatDocumentId(store)
    const imported = new SceneGraph()
    const page = imported.addPage('Replacement page')
    const handle = store.preparationController.begin({
      kind: 'document-reload',
      phase: 'materializing'
    })
    const key = crypto.randomUUID()
    handles.set(key, handle)
    let completed = false
    try {
      await applyImportedDocument(store, imported, handle, page.id)
      if (newSource)
        store.setDocumentSource(
          'replacement.fig',
          'fig',
          undefined,
          '/chat-owner-fixture/replacement.fig'
        )
      handle.complete()
      completed = true
      return {
        oldGraph,
        newGraph: ordinal(store.graph),
        documentId,
        newDocumentId: chatDocumentId(store)
      }
    } finally {
      if (!completed) handle.cancel('user')
      handles.delete(key)
    }
  }
  function changeSourceIdentity() {
    const store = activeTab.value?.store
    if (!store) throw new Error('No active editor')
    store.setDocumentSource(
      'other-source.fig',
      'fig',
      undefined,
      '/chat-owner-fixture/other-source.fig'
    )

    return chatDocumentId(store)
  }
  function documentNodes() {
    const graph = activeTab.value?.store.graph
    return graph
      ? graph
          .getPages()
          .flatMap((page) => page.childIds)
          .map((id) => ({ id, name: graph.getNode(id)?.name }))
      : []
  }
  async function installPredispatchFailure() {
    const current = await ai.ensureChat()
    if (!current) throw new Error('Actual public SDK Chat was not initialized')
    const original = current.sendMessage
    const transitions: string[] = []
    const stop = watch(
      () => current.status,
      (status) => transitions.push(status),
      { flush: 'sync' }
    )
    current.sendMessage = (message, options) =>
      original(message ? { ...message, messageId: 'missing-message-id' } : message, options)
    cleanups.push(() => {
      current.sendMessage = original
      stop()
    })
    return { transitions: () => [...transitions] }
  }
  function installAcceptedFailure() {
    const setTransport = window.openPencil?.setChatTransport
    if (!setTransport) throw new Error('Existing transport boundary unavailable')
    let calls = 0
    let connections = 0
    setTransport(() => {
      connections++
      return {
        async sendMessages() {
          calls++
          throw new Error('Synthetic connection dropped')
        },
        async reconnectToStream() {
          return null
        }
      }
    })
    return { calls: () => calls, connections: () => connections }
  }

  const originalConvertToBlob = OffscreenCanvas.prototype.convertToBlob
  function installBlobGate() {
    const original = HTMLCanvasElement.prototype.toBlob
    const pending: Array<() => void> = []
    let open = false
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      original.call(
        this,
        (blob) => {
          const deliver = () => callback(blob)
          if (open) deliver()
          else pending.push(deliver)
        },
        type,
        quality
      )
    }
    OffscreenCanvas.prototype.convertToBlob = async function (options) {
      const blob = await originalConvertToBlob.call(this, options)
      if (!open) {
        await new Promise<void>((resolve) => {
          pending.push(resolve)
        })
      }
      return blob
    }
    const release = () => {
      open = true
      for (const callback of pending.splice(0)) callback()
    }
    cleanups.push(() => {
      HTMLCanvasElement.prototype.toBlob = original
      OffscreenCanvas.prototype.convertToBlob = originalConvertToBlob
      release()
    })
    return { waiting: () => pending.length, release }
  }
  async function startPNG() {
    const canvas = new OffscreenCanvas(8, 8)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Fixture canvas unavailable')
    context.fillStyle = '#08f'
    context.fillRect(0, 0, 8, 8)
    const blob = await originalConvertToBlob.call(canvas, { type: 'image/png' })
    const job = host.addVisualAttachments([
      new File([blob], 'late-image.png', { type: 'image/png' })
    ])
    jobs.push(job)
  }
  function startSVG() {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect width="24" height="12" fill="#f00"/></svg>'
    const job = host.addVisualAttachments([
      new File([svg], 'late-image.svg', { type: 'image/svg+xml' })
    ])
    jobs.push(job)
  }
  function activeDraft() {
    const store = activeTab.value?.store
    return {
      text: useChatDraft(store).value,
      attachments: useChatAttachments(store).value.map((a) => a.name),
      pending: useChatSubmissionPending(store).value
    }
  }
  return {
    snapshot,
    prepare,
    settle,
    newOwnerPreparing,
    newOwner,
    installHeldRender,
    startSamePathReplacement,
    changeSourceIdentity,
    documentNodes,
    installPredispatchFailure,
    installAcceptedFailure,
    installBlobGate,
    startPNG,
    startSVG,
    activeDraft,
    lateIntent: (contextId: string) =>
      handleAIPopoutIntent({
        protocolVersion: 1,
        contextId,
        clientActionId: crypto.randomUUID(),
        type: 'submit',
        text: 'Stale owner must not receive this'
      }),
    newConversation: () => host.handleHistoryAction(() => ai.history.newChat()),
    retryTwice: () => Promise.all([host.handleRegenerate(), host.handleRegenerate()]),
    async readStoredConversation(id: string) {
      const conversation = await createConversationStore().read(id)
      return conversation
        ? {
            id: conversation.id,
            documentId: conversation.documentId,
            messages: conversation.messages.map((m) => ({ id: m.message.id, role: m.message.role }))
          }
        : null
    },
    async dispose() {
      for (const stop of cleanups.splice(0).reverse()) stop()
      for (const handle of handles.values()) handle.cancel('user')
      handles.clear()
      await Promise.allSettled(jobs)
      if (originalTabId) switchTab(originalTabId)
      for (const tabId of addedTabIds.reverse()) await closeTab(tabId, 'discard')
    }
  }
}
