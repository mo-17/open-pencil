import { findEffectPickArtifact, requireEffectPickConfig } from '@open-pencil/core/plugins'

import { buildEffectPickPreviewDocument } from './document'
import {
  EFFECT_PICK_PREVIEW_PROTOCOL,
  parseEffectPickPreviewMessage,
  parseEffectPickReadyEvent
} from './protocol'

// Service-owned weak lifetimes prevent an older owner from clearing a replacement iframe.
const activePreviews = new WeakMap<HTMLIFrameElement, { destroy: () => void }>()

export interface EffectPickPreviewOptions {
  onClick?: () => void
  onError?: (message: string) => void
  reducedMotion?: boolean
  observeVisibility?: (
    frame: HTMLIFrameElement,
    onVisible: (visible: boolean) => void
  ) => () => void
}

/** One owned iframe and private port per selected playground; no editor action authority. */
export function createEffectPickPreview(
  iframe: HTMLIFrameElement,
  initialConfig: unknown,
  options: EffectPickPreviewOptions = {}
) {
  const documentWindow = iframe.ownerDocument.defaultView
  if (!documentWindow) throw new TypeError('Effect preview requires a document Window')
  const ownerWindow: Window = documentWindow
  let config = requireEffectPickConfig(initialConfig)
  activePreviews.get(iframe)?.destroy()
  const ownership = { destroy }
  let instanceId = ''
  let port: MessagePort | null = null
  let disposed = false
  let mounted = false
  let connected = false
  let playing = true
  let onscreen = true
  let reducedMotion = options.reducedMotion ?? false
  let documentLoaded = false
  let bootTimer: ReturnType<typeof setTimeout> | null = null

  function stopPort() {
    if (bootTimer !== null) clearTimeout(bootTimer)
    bootTimer = null
    if (port) {
      port.onmessage = null
      port.close()
      port = null
    }
    mounted = false
    connected = false
    documentLoaded = false
  }

  function post(type: string, payload: Record<string, unknown> = {}) {
    if (!disposed && port)
      port.postMessage({ protocol: EFFECT_PICK_PREVIEW_PROTOCOL, instanceId, type, ...payload })
  }

  function effectivePlay() {
    return playing && onscreen && !iframe.ownerDocument.hidden
  }

  function synchronizeVisibility() {
    if (!disposed) post(effectivePlay() ? 'play' : 'pause')
  }

  function fail(message: string) {
    destroy()
    options.onError?.(message)
  }

  function receive(event: MessageEvent<unknown>) {
    if (disposed) return
    const message = parseEffectPickPreviewMessage(event.data, instanceId)
    if (!message) return
    if (message.type === 'mounted') {
      mounted = true
      post('config', { config })
      if (bootTimer !== null) clearTimeout(bootTimer)
      bootTimer = null
    } else if (message.type === 'loaded') {
      documentLoaded = true
    } else if (
      message.type === 'click' &&
      mounted &&
      findEffectPickArtifact(config)?.events.includes('click')
    ) {
      options.onClick?.()
    } else if (message.type === 'error') {
      fail(message.message)
    }
  }

  function handshake(event: MessageEvent<unknown>) {
    if (
      disposed ||
      connected ||
      !parseEffectPickReadyEvent(event, iframe.contentWindow, instanceId)
    )
      return
    const target = iframe.contentWindow
    if (!target) return
    const channel = new MessageChannel()
    port = channel.port1
    connected = true
    port.onmessage = receive
    port.start()
    // The target is opaque; the exact Window + one-use instance token binds this transfer.
    target.postMessage(
      { protocol: EFFECT_PICK_PREVIEW_PROTOCOL, instanceId, type: 'connect' },
      '*',
      [channel.port2]
    )
    post('mount', { config, reducedMotion, playing: effectivePlay() })
  }

  function loaded() {
    if (!disposed && documentLoaded)
      fail('Effect preview cannot navigate away from its reviewed document')
  }

  function start() {
    stopPort()
    instanceId = crypto.randomUUID()
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.srcdoc = buildEffectPickPreviewDocument(config, instanceId, ownerWindow.location.origin)
    bootTimer = setTimeout(() => fail('Effect preview did not initialize'), 10_000)
  }

  function destroy() {
    if (disposed) return
    post('destroy')
    disposed = true
    stopPort()
    ownerWindow.removeEventListener('message', handshake)
    iframe.ownerDocument.removeEventListener('visibilitychange', synchronizeVisibility)
    stopObserving()
    iframe.removeEventListener('load', loaded)
    if (activePreviews.get(iframe) === ownership) {
      activePreviews.delete(iframe)
      iframe.removeAttribute('srcdoc')
      iframe.removeAttribute('src')
    }
  }

  ownerWindow.addEventListener('message', handshake)
  iframe.ownerDocument.addEventListener('visibilitychange', synchronizeVisibility)
  const visibilityChanged = (visible: boolean) => {
    if (disposed) return
    onscreen = visible
    synchronizeVisibility()
  }
  const stopObserving = options.observeVisibility
    ? options.observeVisibility(iframe, visibilityChanged)
    : (() => {
        const observer = new IntersectionObserver((entries) =>
          visibilityChanged(entries.some((entry) => entry.isIntersecting))
        )
        observer.observe(iframe)
        return () => observer.disconnect()
      })()
  iframe.addEventListener('load', loaded)
  activePreviews.set(iframe, ownership)
  try {
    start()
  } catch (cause) {
    destroy()
    throw cause
  }

  return Object.freeze({
    play() {
      if (!disposed) {
        playing = true
        synchronizeVisibility()
      }
    },
    pause() {
      if (!disposed) {
        playing = false
        post('pause')
      }
    },
    replay() {
      if (!disposed) {
        playing = true
        post('replay')
        synchronizeVisibility()
      }
    },
    setReducedMotion(value: boolean) {
      if (!disposed) {
        reducedMotion = value
        post('reducedMotion', { value })
      }
    },
    setConfig(value: unknown) {
      if (disposed) return
      const next = requireEffectPickConfig(value)
      const changedArtifact =
        next.effectId !== config.effectId || next.artifactDigest !== config.artifactDigest
      config = next
      if (changedArtifact) start()
      else if (mounted) post('config', { config })
      // A pending handshake mounts the latest config, never a stale selection draft.
    },
    destroy
  })
}
