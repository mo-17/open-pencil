import { VIDEO_HLS_LOADER_SOURCE } from './loader'
import { VIDEO_URL_SOURCE } from './url'

export const VIDEO_DEPENDENCIES = Object.freeze({ 'hls.js': '1.7.3' })

export const VIDEO_RUNTIME_SOURCE =
  `${VIDEO_URL_SOURCE}\n${VIDEO_HLS_LOADER_SOURCE}\n` +
  String.raw`
export interface OpenPencilVideoConfig {
  src: string; poster: string; controls: boolean; autoplay: boolean; muted: boolean; loop: boolean; fit: 'contain' | 'cover' | 'fill'
}
export interface VideoInputs { src?: unknown; poster?: unknown; srcBound?: boolean; posterBound?: boolean; preview?: boolean; lang?: string }
const VIDEO_COPY = {
  en: { load: 'Load video', loading: 'Loading video…', invalid: 'Select a video with a valid public HTTPS source and poster.', failed: 'Video could not load. Check the source, CORS and preview network restrictions.', retry: 'Retry video', unsupported: 'This browser cannot play HLS through the controlled media loader.', video: 'Video' },
  'zh-CN': { load: '加载视频', loading: '正在加载视频…', invalid: '请选择包含有效公开 HTTPS 视频和封面地址的内容。', failed: '视频加载失败，请检查素材地址、CORS 和预览网络限制。', retry: '重试视频', unsupported: '当前浏览器不支持通过受控播放器播放 HLS。', video: '视频' }
}

export function mountOpenPencilVideo(host: HTMLDivElement, config: OpenPencilVideoConfig, inputs: VideoInputs = {}): () => void {
  const copy = VIDEO_COPY[inputs.lang === 'zh-CN' ? 'zh-CN' : 'en']
  const video = document.createElement('video')
  video.setAttribute('aria-label', copy.video)
  video.playsInline = true
  video.controls = config.controls
  video.muted = config.muted
  video.loop = config.loop
  video.preload = 'none'
  video.crossOrigin = 'anonymous'
  Object.assign(video.style, { width: '100%', height: '100%', objectFit: config.fit, position: 'absolute', inset: '0' })
  const message = document.createElement('span')
  message.setAttribute('role', 'status')
  Object.assign(message.style, { position: 'absolute', left: '12px', right: '12px', top: '12px', color: '#fff', background: '#0f172ae6', padding: '8px', font: '13px system-ui', zIndex: '2' })
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.openpencilVideoLoad = ''
  button.textContent = copy.load
  Object.assign(button.style, { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', padding: '10px 14px', background: '#0f172a', color: '#fff', border: '1px solid #fff', borderRadius: '6px', cursor: 'pointer', zIndex: '2147483647' })
  host.replaceChildren(video, message, button)
  let hls: Hls | undefined
  let disposed = false
  let active = false
  const source = safeVideoURL(inputs.srcBound ? inputs.src : config.src)
  const rawPoster = inputs.posterBound ? inputs.poster : config.poster
  const poster = rawPoster === '' ? '' : safeVideoURL(rawPoster)
  const dynamic = inputs.srcBound === true || inputs.posterBound === true
  const stop = () => {
    active = false
    hls?.destroy(); hls = undefined
    video.pause(); video.removeAttribute('src'); video.removeAttribute('poster'); video.load()
  }
  const failure = (text = copy.failed) => {
    if (disposed) return
    stop()
    message.textContent = text; message.hidden = false; message.setAttribute('role', 'alert')
    button.hidden = false; button.disabled = false; button.textContent = copy.retry
  }
  const onError = () => { if (active) failure() }
  const onReady = () => { if (active && !disposed) message.hidden = true }
  video.addEventListener('error', onError)
  video.addEventListener('loadedmetadata', onReady)
  const load = () => {
    if (disposed || !source || poster === null) return
    stop(); active = true
    video.autoplay = !dynamic && config.autoplay && config.muted
    video.preload = video.autoplay ? 'auto' : 'metadata'
    if (poster) video.poster = poster
    message.textContent = copy.loading; message.hidden = false; message.setAttribute('role', 'status')
    button.hidden = true
    if (/\.m3u8$/i.test(new URL(source).pathname)) {
      if (!Hls.isSupported()) { failure(copy.unsupported); return }
      const policy = { default: { maxTimeToFirstByteMs: 15000, maxLoadTimeMs: 45000, timeoutRetry: null, errorRetry: null } }
      try {
        const current = new Hls({ loader: PublicVideoLoader, enableWorker: false, enableInterstitialPlayback: false, emeEnabled: false, progressive: false, maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30, maxBufferSize: 24 * 1024 * 1024, manifestLoadPolicy: policy, playlistLoadPolicy: policy, fragLoadPolicy: policy, keyLoadPolicy: policy })
        hls = current
        current.on(Hls.Events.ERROR, (_event, data) => { if (hls === current && data.fatal && active) failure() })
        current.loadSource(source)
        current.attachMedia(video)
      } catch { failure() }
    } else { video.src = source; video.load() }
  }
  button.addEventListener('click', load)
  const valid = source !== null && poster !== null
  message.hidden = valid
  if (!valid) { message.textContent = copy.invalid; message.setAttribute('role', 'alert'); button.disabled = true }
  else if (!inputs.preview && !dynamic) load()
  return () => { disposed = true; button.removeEventListener('click', load); video.removeEventListener('error', onError); video.removeEventListener('loadedmetadata', onReady); stop(); host.replaceChildren() }
}
`
