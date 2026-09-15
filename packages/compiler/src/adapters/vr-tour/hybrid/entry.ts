export const VR_TOUR_HYBRID_ENTRY = String.raw`
import { mountVRTour, PanoramaError, tourCopy } from './runtime'

const data = JSON.parse(document.getElementById('openpencil-tour-data')?.textContent ?? '{}')
const host = document.getElementById('tour')
const copy = tourCopy(data.config?.locale === 'zh-CN' ? 'zh-CN' : 'en')
const loadAsset = async (url: string, signal: AbortSignal): Promise<Blob> => {
  signal.throwIfAborted()
  const asset = Object.hasOwn(data.assets, url) ? data.assets[url] : undefined
  if (!asset) throw new PanoramaError(data.config?.locale === 'zh-CN' ? '未打包这张全景图，请补充素材后重新构建播放器。' : 'This panorama is not bundled. Add the image and rebuild the player.')
  const binary = atob(asset.base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  signal.throwIfAborted()
  return new Blob([bytes], { type: asset.mime })
}
let dispose: (() => void) | undefined
const cleanup = () => { dispose?.(); dispose = undefined }
if (host && data.config) {
  try { dispose = mountVRTour(host, data.config, undefined, false, { loadAsset, maxPanoramaWidth: 4096 }) }
  catch { host.textContent = copy.unavailable; host.setAttribute('role', 'alert') }
}
Reflect.set(globalThis, '__openpencilDisposeVRTour', cleanup)
addEventListener('pagehide', cleanup, { once: true })
`
