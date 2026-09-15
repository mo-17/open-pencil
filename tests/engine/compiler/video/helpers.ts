import { runInNewContext } from 'node:vm'

import { VIDEO_RUNTIME_SOURCE } from '#compiler/adapters/video/source'
import type { Loader, LoaderContext, LoaderConfiguration } from 'hls.js'

import type { VideoModuleConfigV1 } from '@open-pencil/core/plugins'

export class MediaElement extends EventTarget {
  style: Record<string, string> = {}
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  children: MediaElement[] = []
  textContent = ''
  src = ''
  poster = ''
  hidden = false
  disabled = false
  autoplay = false
  paused = 0
  loads = 0
  constructor(readonly tag: string) {
    super()
  }
  replaceChildren(...children: MediaElement[]) {
    this.children = children
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value)
  }
  removeAttribute(key: string) {
    this.attributes.delete(key)
    if (key === 'src') this.src = ''
    if (key === 'poster') this.poster = ''
  }
  pause() {
    this.paused++
  }
  load() {
    this.loads++
  }
  click() {
    if (!this.disabled) this.dispatchEvent(new Event('click'))
  }
}

export function runtime(fetcher: typeof fetch = fetch) {
  class HlsDouble {
    static supported = true
    static instances: HlsDouble[] = []
    static Events = { ERROR: 'error' }
    static isSupported() {
      return this.supported
    }
    disposed = false
    source = ''
    media?: MediaElement
    error?: (event: string, data: { fatal: boolean }) => void
    constructor(readonly config: Record<string, unknown>) {
      HlsDouble.instances.push(this)
    }
    on(_event: string, callback: (event: string, data: { fatal: boolean }) => void) {
      this.error = callback
    }
    loadSource(source: string) {
      this.source = source
    }
    attachMedia(media: MediaElement) {
      this.media = media
    }
    destroy() {
      this.disposed = true
    }
  }
  const code = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(VIDEO_RUNTIME_SOURCE)
    .replace(/^import .* from ["']hls\.js["'];?\n/gm, '')
    .replace(/^export /gm, '')
  const result = runInNewContext(
    code + '\n({ mountOpenPencilVideo, PublicVideoLoader, safeVideoURL })',
    {
      Hls: HlsDouble,
      document: { createElement: (tag: string) => new MediaElement(tag) },
      fetch: fetcher,
      URL,
      Headers,
      Response,
      AbortController,
      TextDecoder,
      Uint8Array,
      performance,
      setTimeout,
      clearTimeout
    }
  ) as {
    mountOpenPencilVideo(
      host: MediaElement,
      config: VideoModuleConfigV1,
      inputs?: {
        src?: unknown
        poster?: unknown
        srcBound?: boolean
        posterBound?: boolean
        preview?: boolean
        lang?: string
      }
    ): () => void
    PublicVideoLoader: new () => Loader<LoaderContext>
    safeVideoURL(value: unknown): string | null
  }
  return { ...result, HlsDouble }
}

export const loaderConfig: LoaderConfiguration = {
  loadPolicy: {
    maxTimeToFirstByteMs: 1000,
    maxLoadTimeMs: 1000,
    timeoutRetry: null,
    errorRetry: null
  },
  maxRetry: 0,
  timeout: 1000,
  maxRetryDelay: 0,
  retryDelay: 0
}

export function mediaResponse(body: BodyInit, url: string, headers?: HeadersInit): Response {
  const response = new Response(body, { headers })
  Object.defineProperty(response, 'url', { value: url })
  return response
}
