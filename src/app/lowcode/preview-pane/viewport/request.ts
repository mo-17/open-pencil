import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { PREVIEW_MAX_DIMENSION, PREVIEW_MIN_DIMENSION } from './dimensions'

export type WebPreviewWidthOwner = Readonly<Pick<Editor, 'graph'>> & {
  readonly state: Readonly<Pick<Editor['state'], 'currentPageId' | 'sceneVersion'>>
}

export interface WebPreviewWidthRequest {
  readonly serial: number
  readonly graph: SceneGraph
  readonly pageId: string
  readonly width: number
}

export type WebPreviewWidthReason =
  | 'invalid-width'
  | 'stale-context'
  | 'unsupported-target'
  | 'preview-unavailable'
  | 'stale-preview'

export interface WebPreviewWidthState {
  readonly status: 'idle' | 'pending' | 'applied' | 'unavailable' | 'expired'
  readonly serial: number
  readonly width: number | null
  readonly reason: WebPreviewWidthReason | null
}

function createChannel() {
  return {
    serial: 0,
    pending: shallowRef<WebPreviewWidthRequest | null>(null),
    available: shallowRef<boolean | null>(null),
    reason: shallowRef<WebPreviewWidthReason | null>(null),
    state: shallowRef<WebPreviewWidthState>({
      status: 'idle',
      serial: 0,
      width: null,
      reason: null
    })
  }
}

const channels = new WeakMap<WebPreviewWidthOwner, ReturnType<typeof createChannel>>()

function channelFor(owner: WebPreviewWidthOwner) {
  let channel = channels.get(owner)
  if (!channel) {
    channel = createChannel()
    channels.set(owner, channel)
  }
  return channel
}

function matchesContext(owner: WebPreviewWidthOwner, request: WebPreviewWidthRequest): boolean {
  return (
    owner.graph === request.graph &&
    owner.state.currentPageId === request.pageId &&
    owner.graph.getNode(request.pageId)?.type === 'CANVAS'
  )
}

/** Use a real editor session identity, never the shared active-editor proxy. */
export function requestWebPreviewWidth(
  owner: WebPreviewWidthOwner,
  width: number,
  expected: { graph: SceneGraph; pageId: string }
): WebPreviewWidthState {
  const channel = channelFor(owner)
  const serial = ++channel.serial
  const request = { serial, graph: expected.graph, pageId: expected.pageId, width }
  let reason: WebPreviewWidthReason | null = null
  if (!matchesContext(owner, request)) reason = 'stale-context'
  else if (
    !Number.isInteger(width) ||
    width < PREVIEW_MIN_DIMENSION ||
    width > PREVIEW_MAX_DIMENSION
  )
    reason = 'invalid-width'
  else if (channel.available.value === false) reason = channel.reason.value ?? 'preview-unavailable'
  channel.pending.value = reason ? null : request
  channel.state.value = {
    status: reason ? 'unavailable' : 'pending',
    serial,
    width: Number.isFinite(width) ? width : null,
    reason
  }
  return channel.state.value
}

function settle(
  owner: WebPreviewWidthOwner,
  request: WebPreviewWidthRequest,
  status: 'applied' | 'unavailable' | 'expired',
  reason: WebPreviewWidthReason | null
): boolean {
  const channel = channelFor(owner)
  if (channel.pending.value !== request) return false
  channel.pending.value = null
  channel.state.value = { status, serial: request.serial, width: request.width, reason }
  return true
}

export function expireWebPreviewWidthRequest(owner: WebPreviewWidthOwner): void {
  const pending = channelFor(owner).pending.value
  if (pending) settle(owner, pending, 'expired', 'stale-context')
}

/** Unknown availability permits opening a previously collapsed, unmounted Web preview. */
export function setWebPreviewWidthAvailability(
  owner: WebPreviewWidthOwner,
  available: boolean | null,
  reason: WebPreviewWidthReason = 'preview-unavailable'
): void {
  const channel = channelFor(owner)
  channel.available.value = available
  channel.reason.value = available === false ? reason : null
  const pending = channel.pending.value
  if (available === false && pending) settle(owner, pending, 'unavailable', reason)
}

/** Apply only to an acknowledged Web frame owned by this document; never compile or navigate. */
export function applyWebPreviewWidthRequest(
  owner: WebPreviewWidthOwner,
  request: WebPreviewWidthRequest,
  preview: { target: string; phase: string; graph: SceneGraph },
  applyWidth: (width: number) => void
): boolean {
  const channel = channelFor(owner)
  if (channel.pending.value !== request) return false
  if (!matchesContext(owner, request)) return settle(owner, request, 'expired', 'stale-context')
  if (preview.target !== 'react' && preview.target !== 'vue')
    return settle(owner, request, 'unavailable', 'unsupported-target')
  if (preview.phase === 'unsupported' || preview.phase === 'error')
    return settle(owner, request, 'unavailable', 'preview-unavailable')
  if (preview.phase !== 'ready') return false
  if (preview.graph !== request.graph) return settle(owner, request, 'unavailable', 'stale-preview')
  applyWidth(request.width)
  return settle(owner, request, 'applied', null)
}

/** Reactive feedback and pending work remain scoped to the current session, graph and page. */
export function useWebPreviewWidthRequest(owner: () => WebPreviewWidthOwner) {
  const stop = watch(
    () => {
      const current = owner()
      return [
        current,
        current.graph,
        current.state.currentPageId,
        current.state.sceneVersion
      ] as const
    },
    (current, previous) => {
      if (previous[0] !== current[0]) expireWebPreviewWidthRequest(previous[0])
      const pending = channelFor(current[0]).pending.value
      if (pending && !matchesContext(current[0], pending)) expireWebPreviewWidthRequest(current[0])
    },
    { flush: 'sync' }
  )
  onScopeDispose(stop)
  return {
    pending: computed(() => {
      const current = owner()
      const pending = channelFor(current).pending.value
      return pending && matchesContext(current, pending) ? pending : null
    }),
    state: computed(() => channelFor(owner()).state.value),
    available: computed(() => channelFor(owner()).available.value)
  }
}
