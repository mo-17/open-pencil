import { VR_TOUR_SAMPLE_ASSETS, type VRTourSampleAsset } from '@open-pencil/core/plugins'

import { VRTourSampleAssetError } from './types'
import { validateVRTourSampleBytes } from './validate'

export type VRTourSampleFetch = typeof fetch

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function assertNotAborted(signal: AbortSignal): void {
  if (isAborted(signal)) throw new VRTourSampleAssetError('cancelled')
}

function validateResponse(response: Response, asset: VRTourSampleAsset) {
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url !== '' && response.url !== asset.downloadUrl) ||
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg' ||
    !response.body
  )
    throw new VRTourSampleAssetError('response')
  const declared = response.headers.get('content-length')
  if (declared !== null && declared !== String(asset.byteLength))
    throw new VRTourSampleAssetError('size')
  return response.body
}

/** Fixed host-owned asset sources only; this does not widen panorama URL validation. */
export async function downloadVRTourSampleAsset(
  asset: VRTourSampleAsset,
  parentSignal: AbortSignal,
  fetcher: VRTourSampleFetch,
  timeoutMs = 60_000
): Promise<Uint8Array> {
  if (!VR_TOUR_SAMPLE_ASSETS.includes(asset)) throw new VRTourSampleAssetError('integrity')
  assertNotAborted(parentSignal)
  const controller = new AbortController()
  const abort = () => controller.abort()
  parentSignal.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timeoutOccurred = () => timedOut
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let body: ReadableStream<Uint8Array> | null = null
  try {
    const response = await fetcher(asset.downloadUrl, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store'
    })
    body = response.body
    reader = validateResponse(response, asset).getReader()
    const bytes = new Uint8Array(asset.byteLength)
    let received = 0
    for (;;) {
      assertNotAborted(controller.signal)
      const part = await reader.read()
      if (part.done) break
      if (received + part.value.byteLength > bytes.byteLength)
        throw new VRTourSampleAssetError('size')
      bytes.set(part.value, received)
      received += part.value.byteLength
    }
    if (received !== asset.byteLength) throw new VRTourSampleAssetError('size')
    const verified = await validateVRTourSampleBytes(asset, bytes)
    assertNotAborted(controller.signal)
    return verified
  } catch (error) {
    if (timeoutOccurred()) throw new VRTourSampleAssetError('timeout')
    if (isAborted(parentSignal)) throw new VRTourSampleAssetError('cancelled')
    if (error instanceof VRTourSampleAssetError) throw error
    throw new VRTourSampleAssetError('network')
  } finally {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', abort)
    if (reader) {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    } else if (body) {
      await body.cancel().catch(() => undefined)
    }
  }
}
