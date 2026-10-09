import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import type { SceneGraph } from '@open-pencil/scene-graph'

export interface AssetLibraryOwner {
  readonly graph: SceneGraph
  readonly state: { readonly currentPageId: string; readonly sceneVersion: number }
}

export interface AssetLibraryRequest {
  readonly graph: SceneGraph
  readonly pageId: string
}

const requests = new WeakMap<AssetLibraryOwner, ReturnType<typeof createChannel>>()

function createChannel() {
  return shallowRef<AssetLibraryRequest | null>(null)
}

function channelFor(owner: AssetLibraryOwner) {
  let channel = requests.get(owner)
  if (!channel) {
    channel = createChannel()
    requests.set(owner, channel)
  }
  return channel
}

/** A real editor session owns the request, including when its assets view is unmounted. */
export function requestEffectPickLibrary(owner: AssetLibraryOwner): void {
  channelFor(owner).value = { graph: owner.graph, pageId: owner.state.currentPageId }
}

export function pendingAssetLibraryRequest(owner: AssetLibraryOwner): AssetLibraryRequest | null {
  void owner.state.sceneVersion
  const request = channelFor(owner).value
  if (!request) return null
  return owner.graph === request.graph &&
    owner.state.currentPageId === request.pageId &&
    owner.graph.getNode(request.pageId)?.type === 'CANVAS'
    ? request
    : null
}

export function consumeAssetLibraryRequest(
  owner: AssetLibraryOwner,
  request: AssetLibraryRequest,
  browse: () => void
): boolean {
  if (pendingAssetLibraryRequest(owner) !== request) return false
  channelFor(owner).value = null
  browse()
  return true
}

export function expireAssetLibraryRequest(owner: AssetLibraryOwner): void {
  channelFor(owner).value = null
}

export function useAssetLibraryRequest(owner: AssetLibraryOwner) {
  watch(
    () => {
      void owner.state.sceneVersion
      return [owner.graph, owner.state.currentPageId] as const
    },
    (current, previous) => {
      if (current[0] !== previous[0] || current[1] !== previous[1]) expireAssetLibraryRequest(owner)
    },
    { flush: 'sync' }
  )
  onScopeDispose(() => expireAssetLibraryRequest(owner))
  return computed(() => pendingAssetLibraryRequest(owner))
}
