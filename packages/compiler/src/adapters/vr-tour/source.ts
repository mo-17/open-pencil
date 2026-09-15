import { VR_TOUR_COPY_SOURCE } from './copy'
import { VR_TOUR_IMAGE_HEADER_SOURCE } from './image-header'

/** Reviewed, local npm runtimes only. Keep the Three version inside PSV's range. */
export const VR_TOUR_DEPENDENCIES = Object.freeze({
  '@photo-sphere-viewer/core': '5.15.1',
  '@photo-sphere-viewer/markers-plugin': '5.15.1',
  three: '0.185.1'
})

export const VR_TOUR_RUNTIME_SOURCE = String.raw`
import { Viewer, Cache } from '@photo-sphere-viewer/core'
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin'
import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/markers-plugin/index.css'

// This generated runtime owns its PSV instances. Disable the shared image cache
// before constructing one so disposed panoramas and the cache timer are not retained.
Cache.enabled = false

${VR_TOUR_COPY_SOURCE}
${VR_TOUR_IMAGE_HEADER_SOURCE}

type TourHotspot = { id: string; label: string; targetSceneId: string; yaw: number; pitch: number }
type TourScene = { id: string; title: string; panoramaUrl: string; hotspots: readonly TourHotspot[] }
type TourConfig = {
  locale?: TourLocale; label: string; scenes: readonly TourScene[]; initialSceneId: string;
  initialYaw: number; initialPitch: number; initialFov: number;
  showControls: boolean; showSceneList: boolean;
  accentColor: string; backgroundColor: string; textColor: string
}

/** Same closed locator policy as the editor; a bound non-string is never fallback data. */
export function safePanoramaURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  if (value === '') return ''
  if (/^\/assets\/vr-tour\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(value)) return value
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.href !== value || url.username || url.password || url.hash || url.search || url.port || /[?#%]/.test(value)) return null
    if (!/\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)) return null
    if (hostname.endsWith('.') || ['localhost', 'localdomain', 'home.arpa'].includes(hostname)) return null
    if (['.localhost', '.local', '.localdomain', '.home.arpa'].some(suffix => hostname.endsWith(suffix))) return null
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith('[')) return null
    return value
  } catch { return null }
}

const MAX_IMAGE_BYTES = 24 * 1024 * 1024
type TourHostOptions = { loadAsset?: (url: string, signal: AbortSignal) => Promise<Blob>; maxPanoramaWidth?: number }
async function downloadPanorama(url: string, signal: AbortSignal, locale: TourLocale): Promise<Blob> {
  const copy = tourCopy(locale)
  const response = await fetch(url, { signal, credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' })
  if (!response.ok || !response.body) throw new PanoramaError(copy.requestFailed)
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) { await response.body.cancel(); throw new PanoramaError(copy.expectedImage) }
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body.cancel(); throw new PanoramaError(copy.tooLarge) }
  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > MAX_IMAGE_BYTES) throw new PanoramaError(copy.tooLarge)
      chunks.push(part.value.slice().buffer)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  signal.throwIfAborted()
  return new Blob(chunks, { type: mime })
}

async function panoramaBlob(url: string, signal: AbortSignal, locale: TourLocale, options: TourHostOptions): Promise<Blob> {
  const copy = tourCopy(locale)
  const blob = options.loadAsset && url.startsWith('/assets/vr-tour/')
    ? await options.loadAsset(url, signal) : await downloadPanorama(url, signal, locale)
  if (blob.size > MAX_IMAGE_BYTES) throw new PanoramaError(copy.tooLarge)
  const mime = blob.type
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new PanoramaError(copy.expectedImage)
  const dimensions = panoramaDimensions(new Uint8Array(await blob.arrayBuffer()), mime, locale)
  signal.throwIfAborted()
  let temporaryURL: string | undefined
  let bitmap: ImageBitmap | HTMLImageElement
  if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(blob)
  else {
    temporaryURL = URL.createObjectURL(blob)
    const image = new Image()
    image.src = temporaryURL
    try { await image.decode(); bitmap = image }
    catch (error) { URL.revokeObjectURL(temporaryURL); throw error }
  }
  try {
    if (bitmap.width !== dimensions[0] || bitmap.height !== dimensions[1]) throw new PanoramaError(copy.mismatchedDimensions)
    signal.throwIfAborted()
    const width = options.maxPanoramaWidth
    if (width && bitmap.width > width) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = width / 2
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new PanoramaError(copy.unavailable)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const resized = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new PanoramaError(copy.unavailable)), 'image/jpeg', 0.9))
        signal.throwIfAborted()
        return resized
      } finally { canvas.width = 0; canvas.height = 0 }
    }
  } finally {
    if ('close' in bitmap) bitmap.close()
    if (temporaryURL) URL.revokeObjectURL(temporaryURL)
  }
  signal.throwIfAborted()
  return blob
}

export function mountVRTour(host: HTMLElement, config: TourConfig, boundURL?: unknown, bound = false, options: TourHostOptions = {}): () => void {
  const locale = config.locale === 'zh-CN' ? 'zh-CN' : 'en'
  const copy = tourCopy(locale)
  let disposed = false
  let generation = 0
  let viewer: Viewer | undefined
  let request: AbortController | undefined
  let objectURL: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cleanups: Array<() => void> = []
  const sceneCleanups: Array<() => void> = []
  const section = document.createElement('section')
  section.setAttribute('aria-label', config.label)
  section.lang = locale
  section.style.cssText = 'width:100%;height:100%;min-height:280px;display:flex;flex-direction:column;overflow:hidden;border-radius:12px;position:relative;isolation:isolate;font:14px/1.4 system-ui,sans-serif'
  section.style.backgroundColor = config.backgroundColor
  section.style.color = config.textColor
  const toolbar = document.createElement('div')
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', copy.toolbar)
  toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px;flex-wrap:wrap;flex-shrink:0'
  const title = document.createElement('strong')
  title.style.cssText = 'flex:1;min-width:100px'
  const source = document.createElement('div')
  source.style.cssText = 'font-size:12px;overflow-wrap:anywhere;padding:0 10px 8px;flex-shrink:0'
  const status = document.createElement('div')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.style.cssText = 'padding:8px 10px;flex-shrink:0'
  const viewport = document.createElement('div')
  viewport.style.cssText = 'position:relative;min-height:180px;flex:1;outline-offset:-3px'
  viewport.tabIndex = 0
  viewport.setAttribute('role', 'region')
  viewport.setAttribute('aria-label', copy.viewport)
  const sceneURL = bound ? safePanoramaURL(boundURL) : undefined
  const scenes: readonly TourScene[] = bound
    ? [{ id: 'selected-property', title: config.label, panoramaUrl: sceneURL ?? '', hotspots: [] }]
    : config.scenes
  let current = scenes.find(scene => scene.id === config.initialSceneId) ?? scenes[0]
  const button = (label: string, action: () => void, scope = cleanups, ariaLabel = label): HTMLButtonElement => {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = label
    element.setAttribute('aria-label', ariaLabel)
    element.title = ariaLabel
    element.style.cssText = 'min-height:36px;padding:6px 12px;border:1px solid currentColor;border-radius:7px;cursor:pointer;background:transparent;color:inherit;font:inherit'
    element.addEventListener('click', action)
    scope.push(() => element.removeEventListener('click', action))
    return element
  }
  const unload = (): void => {
    generation += 1
    request?.abort()
    request = undefined
    clearTimeout(timer)
    timer = undefined
    sceneCleanups.splice(0).forEach(cleanup => cleanup())
    const previous = viewer
    viewer = undefined
    previous?.destroy()
    if (objectURL) URL.revokeObjectURL(objectURL)
    objectURL = undefined
    viewport.replaceChildren()
  }
  const reset = (): void => {
    viewer?.rotate({ yaw: config.initialYaw * Math.PI / 180, pitch: config.initialPitch * Math.PI / 180 })
    viewer?.zoom((100 - config.initialFov) / 60 * 100)
  }
  const loadButton = button(copy.load, () => { void load() })
  loadButton.style.backgroundColor = config.accentColor
  const updateSource = (): void => {
    title.textContent = current?.title ?? config.label
    const url = bound ? sceneURL : safePanoramaURL(current?.panoramaUrl)
    source.textContent = url ? copy.source + url : copy.noImage
    loadButton.disabled = !url
    status.textContent = url === null ? copy.invalidURL : url === '' ? copy.placeholder : copy.offline
  }
  const chooseScene = (scene: TourScene): void => {
    unload()
    current = scene
    if (select) select.value = scene.id
    updateSource()
  }
  async function load(): Promise<void> {
    const scene = current
    const url = bound ? sceneURL : safePanoramaURL(scene?.panoramaUrl)
    if (disposed || !scene || !url) return
    unload()
    const token = generation
    const controller = new AbortController()
    request = controller
    timer = setTimeout(() => controller.abort(), 20000)
    status.textContent = copy.loading
    loadButton.disabled = true
    try {
      const blob = await panoramaBlob(url, controller.signal, locale, options)
      if (disposed || token !== generation) return
      objectURL = URL.createObjectURL(blob)
      const active = new Viewer({
        container: viewport, lang: { ...copy.viewer }, navbar: false, plugins: [MarkersPlugin.withConfig({ markers: [] })],
        minFov: 40, maxFov: 100, defaultZoomLvl: (100 - config.initialFov) / 60 * 100,
        defaultYaw: config.initialYaw * Math.PI / 180, defaultPitch: config.initialPitch * Math.PI / 180,
        keyboard: false, mousewheel: true, mousewheelCtrlKey: true, canvasBackground: config.backgroundColor
      })
      viewer = active
      const loaded = await active.setPanorama(objectURL)
      if (disposed || token !== generation || viewer !== active) return
      if (!loaded) throw new PanoramaError(copy.displayFailed)
      const markers = active.getPlugin<MarkersPlugin>(MarkersPlugin)
      markers.setMarkers(scene.hotspots.map(hotspot => {
        const target = scenes.find(candidate => candidate.id === hotspot.targetSceneId)
        const element = button(hotspot.label + ' →', () => {
          if (target) { chooseScene(target); viewport.focus() }
        }, sceneCleanups)
        element.style.backgroundColor = config.accentColor
        element.setAttribute('aria-label', hotspot.label + copy.hotspotHint)
        return { id: hotspot.id, element, position: { yaw: hotspot.yaw * Math.PI / 180, pitch: hotspot.pitch * Math.PI / 180 } }
      }))
      status.textContent = copy.ready
      viewport.focus()
    } catch (error) {
      if (disposed || token !== generation) return
      const timedOut = controller.signal.aborted
      unload()
      loadButton.disabled = false
      status.textContent = timedOut ? copy.timedOut : error instanceof PanoramaError ? error.message : copy.unavailable
    } finally {
      if (!disposed && token === generation) { clearTimeout(timer); timer = undefined; request = undefined; loadButton.disabled = false }
    }
  }
  let select: HTMLSelectElement | undefined
  toolbar.append(title)
  if (config.showSceneList && scenes.length > 1) {
    select = document.createElement('select')
    select.setAttribute('aria-label', copy.room)
    select.style.cssText = 'min-height:36px;padding:4px 8px;color:inherit;background:inherit;border:1px solid currentColor;border-radius:6px'
    for (const scene of scenes) { const option = document.createElement('option'); option.value = scene.id; option.textContent = scene.title; select.append(option) }
    select.value = current?.id ?? ''
    const change = (): void => { const scene = scenes.find(item => item.id === select?.value); if (scene) chooseScene(scene) }
    select.addEventListener('change', change)
    cleanups.push(() => select?.removeEventListener('change', change))
    toolbar.append(select)
  }
  toolbar.append(loadButton)
  if (config.showControls) toolbar.append(button('−', () => viewer?.zoom(Math.max(0, viewer.getZoomLevel() - 10)), cleanups, copy.viewer.zoomOut), button('+', () => viewer?.zoom(Math.min(100, viewer.getZoomLevel() + 10)), cleanups, copy.viewer.zoomIn), button(copy.reset, reset))
  const keydown = (event: KeyboardEvent): void => {
    if (!viewer || event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey) return
    const position = viewer.getPosition()
    const step = Math.PI / 36
    if (event.key === 'ArrowLeft') viewer.rotate({ ...position, yaw: position.yaw - step })
    else if (event.key === 'ArrowRight') viewer.rotate({ ...position, yaw: position.yaw + step })
    else if (event.key === 'ArrowUp') viewer.rotate({ ...position, pitch: Math.min(Math.PI * 85 / 180, position.pitch + step) })
    else if (event.key === 'ArrowDown') viewer.rotate({ ...position, pitch: Math.max(-Math.PI * 85 / 180, position.pitch - step) })
    else if (event.key === '+' || event.key === '=') viewer.zoom(Math.min(100, viewer.getZoomLevel() + 10))
    else if (event.key === '-') viewer.zoom(Math.max(0, viewer.getZoomLevel() - 10))
    else if (event.key === 'Home') reset()
    else return
    event.preventDefault()
  }
  viewport.addEventListener('keydown', keydown)
  section.append(toolbar, source, viewport, status)
  host.append(section)
  updateSource()
  return () => {
    if (disposed) return
    disposed = true
    unload()
    viewport.removeEventListener('keydown', keydown)
    cleanups.forEach(cleanup => cleanup())
    section.remove()
  }
}
`
