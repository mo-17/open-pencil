import { useClipboard } from '@vueuse/core'
import { computed, inject, provide, proxyRefs, ref, watch } from 'vue'
import type { InjectionKey, ShallowUnwrapRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useI18n } from '@open-pencil/vue'

import { DEFAULT_COLLAB_STATE, useCollabInjected } from '@/app/collab/use'
import { toast } from '@/app/shell/ui'

function createCollabPanelContext() {
  const route = useRoute()
  const router = useRouter()
  const collab = useCollabInjected()
  const { copy, copied } = useClipboard({ copiedDuring: 2000 })
  const { dialogs } = useI18n()

  const joinInput = ref('')
  const nameDraft = ref(collab?.state.value.localName ?? '')
  const pendingRoomId = computed(() =>
    typeof route.params.roomId === 'string' ? route.params.roomId : null
  )
  const popoverOpen = ref(!!pendingRoomId.value)
  const state = computed(() => collab?.state.value ?? DEFAULT_COLLAB_STATE)
  const peers = computed(() => collab?.remotePeers.value ?? [])
  const followingPeer = computed(() => collab?.followingPeer.value ?? null)
  // Phase 3 §4.2 — the room key rides the URL fragment (`#k=…`) so it never
  // reaches a server; the bare roomId alone no longer grants access.
  const shareUrl = computed(() => {
    if (!state.value.roomId) return ''
    const base = `${window.location.origin}/share/${state.value.roomId}`
    return state.value.roomKey ? `${base}#k=${state.value.roomKey}` : base
  })
  const isJoining = computed(() => !!pendingRoomId.value && !state.value.connected)

  watch(
    pendingRoomId,
    (roomId) => {
      if (!state.value.connected) popoverOpen.value = !!roomId
    },
    { immediate: true }
  )

  function copyLink() {
    if (!shareUrl.value) return
    void copy(shareUrl.value)
    toast.info('Link copied to clipboard')
  }

  function share() {
    if (!collab || !nameDraft.value.trim()) return
    collab.setLocalName(nameDraft.value.trim())
    const { roomId, key } = collab.shareCurrentDoc()
    void router.push(`/share/${roomId}`)
    void copy(`${window.location.origin}/share/${roomId}#k=${key}`)
    toast.info('Link copied to clipboard')
    popoverOpen.value = false
  }

  // Pull the room id + key out of a pasted invite (full URL, `/share/<id>#k=<key>`,
  // or bare id) or, for a deep-linked join, the route param + hash fragment.
  function parseInvite(): { roomId: string; key: string } {
    if (pendingRoomId.value) {
      const hash = route.hash // e.g. "#k=abc123"
      return { roomId: pendingRoomId.value, key: hash.startsWith('#k=') ? hash.slice(3) : '' }
    }
    const raw = joinInput.value.trim()
    const hashIdx = raw.indexOf('#k=')
    const key = hashIdx !== -1 ? raw.slice(hashIdx + 3) : ''
    const beforeHash = hashIdx !== -1 ? raw.slice(0, hashIdx) : raw
    const roomId = beforeHash.replace(/.*\/share\//, '').replace(/[#?].*$/, '')
    return { roomId, key }
  }

  function join() {
    if (!collab) return
    const { roomId, key } = parseInvite()
    if (!roomId || !nameDraft.value.trim()) return
    // §4.2 — the room key is mandatory (overturns the legacy empty-password
    // fallback): a bare roomId with no key must not open any room. Without it
    // we'd silently join the unauthenticated empty-password variant.
    if (!key) {
      toast.error(dialogs.value.roomKeyError)
      return
    }
    collab.setLocalName(nameDraft.value.trim())
    collab.connect(roomId, key, () => toast.error(dialogs.value.roomKeyError))
    void router.push(`/share/${roomId}#k=${key}`)
    popoverOpen.value = false
  }

  function disconnect() {
    if (!collab) return
    collab.disconnect()
    popoverOpen.value = false
    void router.push('/')
  }

  function toggleFollowPeer(clientId: number) {
    collab?.followPeer(followingPeer.value === clientId ? null : clientId)
  }

  return {
    dialogs,
    copied,
    joinInput,
    nameDraft,
    popoverOpen,
    state,
    peers,
    followingPeer,
    shareUrl,
    isJoining,
    copyLink,
    share,
    join,
    disconnect,
    toggleFollowPeer
  }
}

export type CollabPanelContext = ShallowUnwrapRef<ReturnType<typeof createCollabPanelContext>>

const COLLAB_PANEL_KEY: InjectionKey<CollabPanelContext> = Symbol('CollabPanelContext')

export function provideCollabPanel() {
  const ctx = proxyRefs(createCollabPanelContext())
  provide(COLLAB_PANEL_KEY, ctx)
  return ctx
}

export function useCollabPanelContext(): CollabPanelContext {
  const ctx = inject(COLLAB_PANEL_KEY)
  if (!ctx) throw new Error('Collab panel controls must be used within CollabPanel')
  return ctx
}
