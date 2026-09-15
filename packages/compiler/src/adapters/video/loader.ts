/** Generated, credential-free HLS loader. No compiler-time I/O or executable author input. */
export const VIDEO_HLS_LOADER_SOURCE = String.raw`
import Hls, { type Loader, type LoaderContext, type LoaderConfiguration, type LoaderCallbacks, type LoaderStats } from 'hls.js'

type VideoLoad = { context: LoaderContext; callbacks: LoaderCallbacks<LoaderContext>; controller: AbortController; stats: LoaderStats; timer?: ReturnType<typeof setTimeout> }
function videoLoadStats(): LoaderStats {
  return { aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
    loading: { start: performance.now(), first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } }
}
function videoLoadTimeout(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 60000) : fallback
}
function videoRequestHeaders(context: LoaderContext): Headers {
  const headers = new Headers()
  // Do not forward arbitrary headers from playlist/controller context.
  // hls.js FragmentLoader uses 0/0 for ordinary segments without a byte range.
  if ((context.rangeStart ?? 0) === 0 && (context.rangeEnd ?? 0) === 0) return headers
  if (context.rangeStart !== undefined || context.rangeEnd !== undefined) {
    const start = context.rangeStart ?? 0
    const end = context.rangeEnd
    if (!Number.isSafeInteger(start) || start < 0 || end === undefined || !Number.isSafeInteger(end) || end <= start) throw new Error('Invalid media range')
    headers.set('Range', 'bytes=' + start + '-' + (end - 1))
  }
  return headers
}

export class PublicVideoLoader implements Loader<LoaderContext> {
  context: LoaderContext | null = null
  stats: LoaderStats = videoLoadStats()
  private current?: VideoLoad
  private response?: Response

  load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
    this.abort()
    this.context = context
    // FragmentLoader retains loader.stats before load() and seeds its retry count.
    Object.assign(this.stats, videoLoadStats(), { retry: this.stats.retry })
    this.response = undefined
    const state: VideoLoad = { context, callbacks, stats: this.stats, controller: new AbortController() }
    this.current = state
    this.armTimeout(state, videoLoadTimeout(config.loadPolicy.maxTimeToFirstByteMs, 15000))
    void this.run(state, config)
  }
  abort(): void {
    const state = this.current
    if (!state) return
    this.current = undefined
    clearTimeout(state.timer)
    state.stats.aborted = true
    state.controller.abort()
    state.callbacks.onAbort?.(state.stats, state.context, null)
  }
  destroy(): void { this.abort(); this.context = null; this.response = undefined }
  getCacheAge(): number | null {
    const value = this.response?.headers.get('age')
    return value && /^\d+$/.test(value) ? Number(value) : null
  }
  getResponseHeader(name: string): string | null { return this.response?.headers.get(name) ?? null }
  private armTimeout(state: VideoLoad, milliseconds: number): void {
    clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      if (this.current !== state) return
      this.current = undefined
      state.stats.aborted = true
      state.controller.abort()
      state.callbacks.onTimeout(state.stats, state.context, null)
    }, Math.max(1, milliseconds))
  }
  private async run(state: VideoLoad, config: LoaderConfiguration): Promise<void> {
    const { context, stats, callbacks } = state
    try {
      if (!safeVideoURL(context.url)) throw new Error('Unsafe media URL')
      const response = await fetch(context.url, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: videoRequestHeaders(context), signal: state.controller.signal })
      if (this.current !== state) return
      if (!response.ok || response.redirected || (response.url && (!safeVideoURL(response.url) || response.url !== context.url))) throw new Error('Media response blocked')
      this.response = response
      stats.loading.first = performance.now()
      this.armTimeout(state, videoLoadTimeout(config.loadPolicy.maxLoadTimeMs, 45000) - (stats.loading.first - stats.loading.start))
      const bytes = await this.readBody(response, state)
      if (this.current !== state) return
      const text = context.responseType === 'arraybuffer' ? undefined : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const data = context.responseType === 'arraybuffer' ? bytes.buffer : context.responseType === 'json' ? JSON.parse(text ?? '') : text ?? ''
      stats.loading.end = performance.now()
      stats.total = stats.loaded
      stats.bwEstimate = stats.loaded * 8000 / Math.max(1, stats.loading.end - stats.loading.start)
      clearTimeout(state.timer)
      if (context.responseType !== 'json') callbacks.onProgress?.(stats, context, data, response)
      if (this.current !== state) return
      this.current = undefined
      callbacks.onSuccess({ url: context.url, data, code: response.status }, stats, context, response)
    } catch {
      if (this.current !== state) return
      this.current = undefined
      clearTimeout(state.timer)
      state.controller.abort()
      callbacks.onError({ code: 0, text: 'Media request failed or was blocked' }, context, null, stats)
    }
  }
  private async readBody(response: Response, state: VideoLoad): Promise<Uint8Array<ArrayBuffer>> {
    const maximum = state.context.type === 'key' ? 65536 : state.context.responseType === 'arraybuffer' ? 24 * 1024 * 1024 : 1024 * 1024
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maximum) throw new Error('Media response too large')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing media body')
    const parts: Uint8Array[] = []
    try {
      while (true) {
        state.controller.signal.throwIfAborted()
        const result = await reader.read()
        state.controller.signal.throwIfAborted()
        if (result.done) break
        state.stats.loaded += result.value.byteLength
        state.stats.chunkCount++
        if (state.stats.loaded > maximum) throw new Error('Media response too large')
        parts.push(result.value)
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
    const bytes = new Uint8Array(state.stats.loaded)
    let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
    return bytes
  }
}
`
