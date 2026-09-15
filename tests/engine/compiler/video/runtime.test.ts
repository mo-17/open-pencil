import { expect, mock, test } from 'bun:test'

import { LoaderContextType, type LoaderContext, type LoaderStats } from 'hls.js'

import { createVideoModuleInstance } from '@open-pencil/core/plugins'
import type { VideoModuleConfigV1 } from '@open-pencil/core/plugins'

import { loaderConfig, MediaElement, mediaResponse, runtime } from './helpers'

const config = createVideoModuleInstance({
  src: 'https://media.example.com/static.mp4',
  poster: '',
  autoplay: true,
  muted: true
}).config as VideoModuleConfigV1

test('video binding activation preserves static autoplay and clears replaced media immediately', () => {
  const { mountOpenPencilVideo } = runtime()
  const host = new MediaElement('div')
  const cleanupStatic = mountOpenPencilVideo(host, config)
  const staticVideo = host.children[0]
  expect(staticVideo.src).toBe(config.src)
  expect(staticVideo.autoplay).toBe(true)
  cleanupStatic()
  expect(staticVideo.src).toBe('')
  expect(staticVideo.paused).toBeGreaterThan(0)
  const cleanup = mountOpenPencilVideo(host, config, {
    srcBound: true,
    src: 'https://media.example.com/selected.webm',
    lang: 'zh-CN'
  })
  const [video, , button] = host.children
  expect(video.src).toBe('')
  expect(button.textContent).toBe('加载视频')
  button.click()
  expect(video.src).toBe('https://media.example.com/selected.webm')
  expect(video.autoplay).toBe(false)
  cleanup()
  expect(video.src).toBe('')
  expect(video.poster).toBe('')
  mountOpenPencilVideo(host, config, { srcBound: true, src: undefined, lang: 'zh-CN' })
  expect(host.children[0].src).toBe('')
  expect(host.children[2].disabled).toBe(true)
  expect(host.children[1].textContent).toContain('有效公开 HTTPS')
})

test('preview and bound poster never fetch an unchecked or missing URL', () => {
  const { mountOpenPencilVideo, safeVideoURL } = runtime()
  for (const value of [
    'http://media.example.com/a.mp4',
    'https://localhost/a.mp4',
    'https://127.0.0.1/a.mp4',
    'https://[::1]/a.mp4',
    'https://a.local/a.mp4',
    'https://user:pass@media.example.com/a.mp4',
    'https://media.example.com/a.mp4#x',
    'https://media.example.com:8443/a.mp4'
  ])
    expect(safeVideoURL(value)).toBeNull()
  const host = new MediaElement('div')
  const cleanup = mountOpenPencilVideo(
    host,
    { ...config, poster: 'https://media.example.com/poster.png' },
    { preview: true }
  )
  expect(host.children[0].src).toBe('')
  expect(host.children[0].poster).toBe('')
  host.children[2].click()
  expect(host.children[0].poster).toBe('https://media.example.com/poster.png')
  cleanup()
  mountOpenPencilVideo(host, config, { posterBound: true, poster: undefined })
  expect(host.children[0].src).toBe('')
  expect(host.children[2].disabled).toBe(true)
})

test('HLS disposal, fatal error retry and unsupported state do not use native fallback', () => {
  const { mountOpenPencilVideo, HlsDouble } = runtime()
  const host = new MediaElement('div')
  const inputs = { srcBound: true, src: 'https://media.example.com/live.m3u8', lang: 'zh-CN' }
  const cleanup = mountOpenPencilVideo(host, config, inputs)
  host.children[2].click()
  const hls = HlsDouble.instances[0]
  expect(hls.config.enableWorker).toBe(false)
  expect(hls.config.loader).toBeFunction()
  expect(host.children[0].src).toBe('')
  hls.error?.('error', { fatal: true })
  expect(hls.disposed).toBe(true)
  expect(host.children[1].textContent).toContain('视频加载失败')
  expect(host.children[2].textContent).toBe('重试视频')
  host.children[2].click()
  const next = HlsDouble.instances[1]
  hls.error?.('error', { fatal: true })
  expect(next.disposed).toBe(false)
  cleanup()
  expect(next.disposed).toBe(true)
  HlsDouble.supported = false
  mountOpenPencilVideo(host, config, inputs)
  host.children[2].click()
  expect(host.children[1].textContent).toContain('不支持')
  expect(host.children[0].src).toBe('')
})

test('native media errors expose retry and cleanup prevents stale element events from changing the replacement', () => {
  const { mountOpenPencilVideo } = runtime()
  const host = new MediaElement('div')
  const cleanup = mountOpenPencilVideo(host, config, { srcBound: true, src: config.src })
  const [video, message, button] = host.children
  button.click()
  video.dispatchEvent(new Event('error'))
  expect(video.src).toBe('')
  expect(message.attributes.get('role')).toBe('alert')
  expect(button.textContent).toBe('Retry video')
  button.click()
  expect(video.src).toBe(config.src)
  expect(video.autoplay).toBe(false)
  video.dispatchEvent(new Event('loadedmetadata'))
  expect(message.hidden).toBe(true)
  cleanup()
  mountOpenPencilVideo(host, config, { srcBound: true, src: 'https://media.example.com/new.mp4' })
  video.dispatchEvent(new Event('error'))
  video.dispatchEvent(new Event('loadedmetadata'))
  expect(host.children[2].textContent).toBe('Load video')
  expect(host.children[0].src).toBe('')
})

test('HLS loader validates each playlist, segment and key URL and rejects redirects', async () => {
  const request = mock(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('error')
    expect(init?.credentials).toBe('omit')
    expect(init?.referrerPolicy).toBe('no-referrer')
    return mediaResponse('#EXTM3U', 'https://media.example.com/live.m3u8')
  })
  const { PublicVideoLoader } = runtime(request as typeof fetch)
  for (const [url, type] of [
    ['https://media.example.com/live.m3u8', LoaderContextType.MANIFEST],
    ['http://media.example.com/segment.ts', LoaderContextType.MEDIA_FRAGMENT],
    ['https://127.0.0.1/key', LoaderContextType.KEY],
    ['https://other.example.com/redirect.m3u8', LoaderContextType.LEVEL]
  ] as const) {
    const loader = new PublicVideoLoader()
    const result = await new Promise<string>((resolve) => {
      loader.load({ url, type, responseType: 'text' }, loaderConfig, {
        onSuccess: () => resolve('ok'),
        onError: () => resolve('error'),
        onTimeout: () => resolve('timeout')
      })
    })
    expect(result).toBe(type === LoaderContextType.MANIFEST ? 'ok' : 'error')
    loader.destroy()
  }
  expect(request).toHaveBeenCalledTimes(2)
})

test('HLS loader reports bounded response stats and byte ranges without forwarding headers', async () => {
  const url = 'https://media.example.com/segment.ts'
  const request = mock(async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    expect(headers.get('range')).toBe('bytes=4-7')
    expect(headers.has('authorization')).toBe(false)
    return mediaResponse(new Uint8Array([1, 2, 3, 4]), url, { 'content-length': '4' })
  })
  const { PublicVideoLoader } = runtime(request as typeof fetch)
  const loader = new PublicVideoLoader()
  // FragmentLoader captures this reference and sets retries before invoking load().
  const fragmentStats = loader.stats
  fragmentStats.retry = 2
  const progress = mock(() => undefined)
  const received = await new Promise<{ bytes: number[]; stats: LoaderStats }>((resolve, reject) => {
    loader.load(
      {
        url,
        type: LoaderContextType.MEDIA_FRAGMENT,
        responseType: 'arraybuffer',
        rangeStart: 4,
        rangeEnd: 8,
        headers: { authorization: 'not-forwarded' }
      },
      loaderConfig,
      {
        onProgress: progress,
        onSuccess: (response, stats) =>
          resolve({ bytes: [...new Uint8Array(response.data as ArrayBuffer)], stats }),
        onError: reject,
        onTimeout: reject
      }
    )
  })
  expect(received.stats).toBe(fragmentStats)
  expect(received.stats.retry).toBe(2)
  expect(received.stats.loaded).toBe(4)
  expect(received.stats.total).toBe(4)
  expect(received.stats.loading.end).toBeGreaterThanOrEqual(received.stats.loading.first)
  expect(received.bytes).toEqual([1, 2, 3, 4])
  expect(progress).toHaveBeenCalledTimes(1)
  loader.destroy()
})

test('real HLS fragment 0/0 ranges mean the entire segment, while invalid ranges fail closed', async () => {
  const url = 'https://media.example.com/segment.ts'
  const request = mock(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).has('range')).toBe(false)
    return mediaResponse(new Uint8Array([1, 2]), url)
  })
  const { PublicVideoLoader } = runtime(request as typeof fetch)
  for (const [rangeStart, rangeEnd] of [
    [0, 0],
    [-1, 4],
    [2, 0],
    [4, 2],
    [0, Number.MAX_SAFE_INTEGER + 1]
  ]) {
    const loader = new PublicVideoLoader()
    const result = await new Promise<string>((resolve) => {
      loader.load(
        {
          url,
          responseType: 'arraybuffer',
          type: LoaderContextType.MEDIA_FRAGMENT,
          rangeStart,
          rangeEnd
        },
        loaderConfig,
        {
          onSuccess: () => resolve('ok'),
          onError: () => resolve('blocked'),
          onTimeout: () => resolve('timeout')
        }
      )
    })
    expect(result).toBe(rangeStart === 0 && rangeEnd === 0 ? 'ok' : 'blocked')
  }
  expect(request).toHaveBeenCalledTimes(1)
})

test('HLS loader suppresses late results after abort/destroy and enforces timeout and byte limits', async () => {
  let complete: ((response: Response) => void) | undefined
  let signal: AbortSignal | undefined
  const pending = mock((_url: string | URL | Request, init?: RequestInit) => {
    signal = init?.signal ?? undefined
    return new Promise<Response>((resolve) => {
      complete = resolve
    })
  })
  const { PublicVideoLoader } = runtime(pending as typeof fetch)
  const loader = new PublicVideoLoader()
  const success = mock(() => undefined)
  const error = mock(() => undefined)
  const abort = mock(() => undefined)
  const context: LoaderContext = {
    url: 'https://media.example.com/live.m3u8',
    type: LoaderContextType.MANIFEST,
    responseType: 'text'
  }
  loader.load(context, loaderConfig, {
    onSuccess: success,
    onError: error,
    onTimeout: error,
    onAbort: abort
  })
  loader.destroy()
  expect(signal?.aborted).toBe(true)
  complete?.(mediaResponse('#EXTM3U', context.url))
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve)
  })
  expect(success).not.toHaveBeenCalled()
  expect(error).not.toHaveBeenCalled()
  expect(abort).toHaveBeenCalledTimes(1)
  const timed = new PublicVideoLoader()
  await new Promise<void>((resolve) => {
    timed.load(
      context,
      { ...loaderConfig, loadPolicy: { ...loaderConfig.loadPolicy, maxTimeToFirstByteMs: 5 } },
      { onSuccess: success, onError: error, onTimeout: () => resolve() }
    )
  })
  expect(signal?.aborted).toBe(true)
  const big = runtime((async () =>
    mediaResponse('short body', context.url, {
      'content-length': String(1024 * 1024 + 1)
    })) as typeof fetch)
  const oversized = new big.PublicVideoLoader()
  const result = await new Promise<string>((resolve) => {
    oversized.load(context, loaderConfig, {
      onSuccess: () => resolve('ok'),
      onTimeout: () => resolve('timeout'),
      onError: () => resolve('blocked')
    })
  })
  expect(result).toBe('blocked')
})

test('an aborted response stream cannot mutate retained stats or report success for the next load', async () => {
  const url = 'https://media.example.com/segment.ts'
  let deliver: (() => void) | undefined
  let reading: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    reading = resolve
  })
  const canceled = mock(() => undefined)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      deliver = () => controller.enqueue(new Uint8Array([9, 9, 9]))
    },
    pull() {
      reading?.()
    },
    cancel: canceled
  })
  const request = mock(async () => mediaResponse(body, url))
  request.mockImplementationOnce(async () => mediaResponse(body, url))
  request.mockImplementation(async () => mediaResponse(new Uint8Array([1, 2]), url))
  const { PublicVideoLoader } = runtime(request as typeof fetch)
  const loader = new PublicVideoLoader()
  const context: LoaderContext = {
    url,
    type: LoaderContextType.MEDIA_FRAGMENT,
    responseType: 'arraybuffer'
  }
  const oldSuccess = mock(() => undefined)
  const oldError = mock(() => undefined)
  const aborted = mock(() => undefined)
  loader.load(context, loaderConfig, {
    onSuccess: oldSuccess,
    onError: oldError,
    onTimeout: oldError,
    onAbort: aborted
  })
  await started
  loader.abort()
  const result = new Promise<number>((resolve, reject) => {
    loader.load(context, loaderConfig, {
      onSuccess: (_response, stats) => resolve(stats.loaded),
      onError: reject,
      onTimeout: reject
    })
  })
  deliver?.()
  expect(await result).toBe(2)
  expect(loader.stats.loaded).toBe(2)
  expect(canceled).toHaveBeenCalledTimes(1)
  expect(aborted).toHaveBeenCalledTimes(1)
  expect(oldSuccess).not.toHaveBeenCalled()
  expect(oldError).not.toHaveBeenCalled()
})
