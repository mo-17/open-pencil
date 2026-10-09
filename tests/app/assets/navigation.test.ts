import { describe, expect, mock, test } from 'bun:test'

import { effectScope, reactive, shallowReactive, watch } from 'vue'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  consumeAssetLibraryRequest,
  expireAssetLibraryRequest,
  pendingAssetLibraryRequest,
  requestEffectPickLibrary,
  useAssetLibraryRequest,
  type AssetLibraryOwner,
  type AssetLibraryRequest
} from '@/app/assets/navigation'
import { useAssetWorkbench } from '@/app/assets/use'
import { setActiveEditorStore, useActiveEditorStoreRef } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session/create'

function createOwner(graph = new SceneGraph()) {
  return { graph, state: { currentPageId: graph.addPage('Assets').id, sceneVersion: 0 } }
}

function createReactiveOwner() {
  const owner = createOwner()
  return shallowReactive({ graph: owner.graph, state: reactive(owner.state) })
}

function subscribeToRequests(owner: AssetLibraryOwner) {
  const scope = effectScope()
  const pending = scope.run(() => useAssetLibraryRequest(owner))
  if (!pending) throw new Error('Expected an asset library request subscription')
  return { scope, pending }
}

function pendingRequest(owner: AssetLibraryOwner): AssetLibraryRequest {
  const request = pendingAssetLibraryRequest(owner)
  if (!request) throw new Error('Expected a pending asset library request')
  return request
}

describe('EffectPick asset library navigation', () => {
  test('browses the EffectPick library after clearing stale workbench filters and messages', () => {
    const activeStore = useActiveEditorStoreRef()
    const previous = activeStore.value
    const owner = createEditorStore()
    const scope = effectScope()
    setActiveEditorStore(owner)
    try {
      const workbench = scope.run(() => useAssetWorkbench())
      if (!workbench) throw new Error('Expected an asset workbench')
      const currentFilters = () => ({
        query: workbench.query.value,
        source: workbench.source.value,
        category: workbench.category.value,
        favoritesOnly: workbench.favoritesOnly.value,
        templateKind: workbench.templateKind.value,
        error: workbench.error.value,
        notice: workbench.notice.value
      })
      workbench.query.value = 'Previous asset search'
      workbench.source.value = 'template'
      workbench.category.value = 'input'
      workbench.favoritesOnly.value = true
      workbench.templateKind.value = 'combination'
      workbench.error.value = 'Previous insertion failed'
      workbench.notice.value = 'Previous asset inserted'

      workbench.browseEffectPickLibrary()

      expect(currentFilters()).toEqual({
        query: 'EffectPick',
        source: 'plugin',
        category: 'all',
        favoritesOnly: false,
        templateKind: 'all',
        error: '',
        notice: ''
      })
    } finally {
      scope.stop()
      if (previous) setActiveEditorStore(previous)
      else activeStore.value = undefined
      owner.dispose()
    }
  })

  test('retains a request until a late subscriber can consume it', () => {
    const owner = createOwner()
    const browse = mock(() => undefined)
    expect(pendingAssetLibraryRequest(owner)).toBeNull()

    requestEffectPickLibrary(owner)
    const request = pendingRequest(owner)
    expect(request.graph).toBe(owner.graph)
    expect(request.pageId).toBe(owner.state.currentPageId)
    expect(pendingAssetLibraryRequest(owner)).toBe(request)
    expect(browse).not.toHaveBeenCalled()

    const stop = watch(
      () => pendingAssetLibraryRequest(owner),
      (pending) => {
        if (pending) consumeAssetLibraryRequest(owner, pending, browse)
      },
      { immediate: true, flush: 'sync' }
    )
    try {
      expect(browse).toHaveBeenCalledTimes(1)
      expect(pendingAssetLibraryRequest(owner)).toBeNull()
      requestEffectPickLibrary(owner)
      expect(browse).toHaveBeenCalledTimes(2)
      expect(pendingAssetLibraryRequest(owner)).toBeNull()
    } finally {
      stop()
    }
  })

  test('consumes a captured request once', () => {
    const owner = createOwner()
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    const request = pendingRequest(owner)

    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(true)
    expect(pendingAssetLibraryRequest(owner)).toBeNull()
    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
    expect(browse).toHaveBeenCalledTimes(1)
  })

  test('refuses a second consumption from within the browse callback', () => {
    const owner = createOwner()
    requestEffectPickLibrary(owner)
    const request = pendingRequest(owner)
    const nestedBrowse = mock(() => undefined)
    const browse = mock(() => consumeAssetLibraryRequest(owner, request, nestedBrowse))

    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(true)
    expect(browse).toHaveBeenCalledTimes(1)
    expect(browse.mock.results[0]?.value).toBe(false)
    expect(nestedBrowse).not.toHaveBeenCalled()
    expect(pendingAssetLibraryRequest(owner)).toBeNull()
  })

  test('replaces repeated requests and refuses the previously captured request', () => {
    const owner = createOwner()
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    const first = pendingRequest(owner)
    requestEffectPickLibrary(owner)
    const latest = pendingRequest(owner)

    expect(latest).not.toBe(first)
    expect(consumeAssetLibraryRequest(owner, first, browse)).toBe(false)
    expect(pendingAssetLibraryRequest(owner)).toBe(latest)
    expect(browse).not.toHaveBeenCalled()
    expect(consumeAssetLibraryRequest(owner, latest, browse)).toBe(true)
    expect(browse).toHaveBeenCalledTimes(1)
  })

  test('preserves a new request created while an older request is consumed', () => {
    const owner = createOwner()
    requestEffectPickLibrary(owner)
    const first = pendingRequest(owner)

    expect(consumeAssetLibraryRequest(owner, first, () => requestEffectPickLibrary(owner))).toBe(
      true
    )
    const latest = pendingRequest(owner)
    expect(latest).not.toBe(first)
    expect(consumeAssetLibraryRequest(owner, first, () => undefined)).toBe(false)
    expect(consumeAssetLibraryRequest(owner, latest, () => undefined)).toBe(true)
    expect(pendingAssetLibraryRequest(owner)).toBeNull()
  })

  test('refuses a request after the current page changes', () => {
    const owner = createOwner()
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    const request = pendingRequest(owner)
    owner.state.currentPageId = owner.graph.addPage('Another page').id

    expect(pendingAssetLibraryRequest(owner)).toBeNull()
    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
    expect(browse).not.toHaveBeenCalled()
    requestEffectPickLibrary(owner)
    const latest = pendingRequest(owner)
    expect(latest.pageId).toBe(owner.state.currentPageId)
    expect(consumeAssetLibraryRequest(owner, latest, browse)).toBe(true)
    expect(browse).toHaveBeenCalledTimes(1)
  })

  test('refuses a replaced graph even when the replacement has the same page ID', () => {
    const owner = createOwner()
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    const request = pendingRequest(owner)
    const replacement = new SceneGraph()
    replacement.createNodeWithId(request.pageId, 'CANVAS', replacement.rootId)
    owner.graph = replacement

    expect(pendingAssetLibraryRequest(owner)).toBeNull()
    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
    expect(browse).not.toHaveBeenCalled()
    requestEffectPickLibrary(owner)
    const latest = pendingRequest(owner)
    expect(latest.graph).toBe(replacement)
    expect(consumeAssetLibraryRequest(owner, latest, browse)).toBe(true)
    expect(browse).toHaveBeenCalledTimes(1)
  })

  test.each(['missing-page', 'document-root'])('refuses an invalid page: %s', (target) => {
    const owner = createOwner()
    const browse = mock(() => undefined)
    owner.state.currentPageId = target === 'document-root' ? owner.graph.rootId : target
    requestEffectPickLibrary(owner)
    const captured = { graph: owner.graph, pageId: owner.state.currentPageId }

    expect(pendingAssetLibraryRequest(owner)).toBeNull()
    expect(consumeAssetLibraryRequest(owner, captured, browse)).toBe(false)
    expect(browse).not.toHaveBeenCalled()
  })

  test('refuses a request whose page was deleted', () => {
    const owner = createOwner()
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    const request = pendingRequest(owner)
    owner.graph.deleteNode(request.pageId)

    expect(pendingAssetLibraryRequest(owner)).toBeNull()
    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
    expect(browse).not.toHaveBeenCalled()
  })

  test('refuses a captured page that is no longer a canvas', () => {
    const owner = createOwner()
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    const request = pendingRequest(owner)
    owner.graph.updateNode(request.pageId, { type: 'FRAME' })

    expect(pendingAssetLibraryRequest(owner)).toBeNull()
    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
    expect(browse).not.toHaveBeenCalled()
  })

  test('isolates real owners even when they share a graph and current page', () => {
    const owner = createOwner()
    const other: AssetLibraryOwner = { graph: owner.graph, state: owner.state }
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    const request = pendingRequest(owner)

    expect(pendingAssetLibraryRequest(other)).toBeNull()
    expect(consumeAssetLibraryRequest(other, request, browse)).toBe(false)
    requestEffectPickLibrary(other)
    const otherRequest = pendingRequest(other)
    expect(otherRequest).not.toBe(request)
    expect(consumeAssetLibraryRequest(owner, otherRequest, browse)).toBe(false)
    expect(consumeAssetLibraryRequest(other, otherRequest, browse)).toBe(true)
    expect(pendingAssetLibraryRequest(owner)).toBe(request)
    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(true)
    expect(browse).toHaveBeenCalledTimes(2)
  })

  test('keeps requests independent across open documents', () => {
    const first = createOwner()
    const second = createOwner()
    const browse = mock(() => undefined)
    requestEffectPickLibrary(first)
    requestEffectPickLibrary(second)
    const firstRequest = pendingRequest(first)
    const secondRequest = pendingRequest(second)

    expect(consumeAssetLibraryRequest(first, secondRequest, browse)).toBe(false)
    expect(consumeAssetLibraryRequest(second, firstRequest, browse)).toBe(false)
    expect(browse).not.toHaveBeenCalled()
    expect(consumeAssetLibraryRequest(first, firstRequest, browse)).toBe(true)
    expect(pendingAssetLibraryRequest(second)).toBe(secondRequest)
    expect(consumeAssetLibraryRequest(second, secondRequest, browse)).toBe(true)
    expect(browse).toHaveBeenCalledTimes(2)
  })

  test('expires only the specified owner and permits a subsequent request', () => {
    const owner = createOwner()
    const other = createOwner()
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    requestEffectPickLibrary(other)
    const request = pendingRequest(owner)
    const otherRequest = pendingRequest(other)

    expireAssetLibraryRequest(owner)
    expireAssetLibraryRequest(owner)
    expect(pendingAssetLibraryRequest(owner)).toBeNull()
    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
    expect(pendingAssetLibraryRequest(other)).toBe(otherRequest)
    expect(browse).not.toHaveBeenCalled()
    requestEffectPickLibrary(owner)
    const latest = pendingRequest(owner)
    expect(latest).not.toBe(request)
    expect(consumeAssetLibraryRequest(owner, latest, browse)).toBe(true)
    expect(browse).toHaveBeenCalledTimes(1)
    expect(pendingAssetLibraryRequest(other)).toBe(otherRequest)
  })

  test('expires a scoped request on a page switch so returning cannot revive it', () => {
    const owner = createReactiveOwner()
    const { scope, pending } = subscribeToRequests(owner)
    const browse = mock(() => undefined)
    try {
      expect(pending.value).toBeNull()
      requestEffectPickLibrary(owner)
      const request = pendingRequest(owner)
      expect(pending.value).toBe(request)

      owner.state.currentPageId = owner.graph.addPage('Another page').id
      expect(pending.value).toBeNull()
      owner.state.currentPageId = request.pageId
      expect(pending.value).toBeNull()
      expect(pendingAssetLibraryRequest(owner)).toBeNull()
      expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
      expect(browse).not.toHaveBeenCalled()
    } finally {
      scope.stop()
    }
  })

  test('expires a scoped request on graph replacement so returning cannot revive it', () => {
    const owner = createReactiveOwner()
    const { scope, pending } = subscribeToRequests(owner)
    const browse = mock(() => undefined)
    try {
      requestEffectPickLibrary(owner)
      const request = pendingRequest(owner)
      const replacement = new SceneGraph()
      replacement.createNodeWithId(request.pageId, 'CANVAS', replacement.rootId)

      owner.graph = replacement
      expect(pending.value).toBeNull()
      owner.graph = request.graph
      expect(pending.value).toBeNull()
      expect(pendingAssetLibraryRequest(owner)).toBeNull()
      expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
      expect(browse).not.toHaveBeenCalled()
    } finally {
      scope.stop()
    }
  })

  test('uses scene updates to observe a replacement graph through a nonreactive accessor', () => {
    const initial = createOwner()
    let currentGraph = initial.graph
    const owner = {
      get graph() {
        return currentGraph
      },
      state: reactive(initial.state)
    }
    const { scope, pending } = subscribeToRequests(owner)
    const browse = mock(() => undefined)
    try {
      requestEffectPickLibrary(owner)
      const request = pendingRequest(owner)
      expect(pending.value).toBe(request)
      const replacement = new SceneGraph()
      replacement.createNodeWithId(request.pageId, 'CANVAS', replacement.rootId)

      currentGraph = replacement
      owner.state.sceneVersion += 1
      expect(pending.value).toBeNull()
      currentGraph = request.graph
      owner.state.sceneVersion += 1
      expect(pending.value).toBeNull()
      expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
      expect(browse).not.toHaveBeenCalled()
    } finally {
      scope.stop()
    }
  })

  test('retains valid requests across scene updates and rechecks page existence', () => {
    const owner = createReactiveOwner()
    const { scope, pending } = subscribeToRequests(owner)
    const browse = mock(() => undefined)
    try {
      requestEffectPickLibrary(owner)
      const request = pendingRequest(owner)
      expect(pending.value).toBe(request)
      owner.graph.createNode('FRAME', request.pageId, { name: 'Unrelated content' })
      owner.state.sceneVersion += 1
      expect(pending.value).toBe(request)

      owner.graph.deleteNode(request.pageId)
      owner.state.sceneVersion += 1
      expect(pending.value).toBeNull()
      expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
      expect(browse).not.toHaveBeenCalled()
    } finally {
      scope.stop()
    }
  })

  test('expires a request when its owning scope is disposed', () => {
    const owner = createReactiveOwner()
    const other = createOwner()
    const { scope, pending } = subscribeToRequests(owner)
    const browse = mock(() => undefined)
    requestEffectPickLibrary(owner)
    requestEffectPickLibrary(other)
    const request = pendingRequest(owner)
    const otherRequest = pendingRequest(other)
    expect(pending.value).toBe(request)

    scope.stop()
    expect(pending.value).toBeNull()
    expect(pendingAssetLibraryRequest(owner)).toBeNull()
    expect(consumeAssetLibraryRequest(owner, request, browse)).toBe(false)
    expect(pendingAssetLibraryRequest(other)).toBe(otherRequest)
    expect(browse).not.toHaveBeenCalled()
  })
})
