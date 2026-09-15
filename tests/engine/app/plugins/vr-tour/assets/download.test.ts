import { expect, test } from 'bun:test'

import { VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins'

import {
  downloadVRTourSampleAsset,
  type VRTourSampleFetch
} from '@/app/plugins/vr-tour/assets/download'
import { validateVRTourSampleBytes } from '@/app/plugins/vr-tour/assets/validate'

import { sampleBytes, sampleResponse } from './helpers'

const asset = VR_TOUR_SAMPLE_ASSETS[0]

test('sample pins validate both unchanged 8K originals and return independent bytes', async () => {
  for (const item of VR_TOUR_SAMPLE_ASSETS) {
    const original = sampleBytes(item)
    const verified = await validateVRTourSampleBytes(item, original)
    expect(verified).toEqual(original)
    expect(verified).not.toBe(original)
    expect(item.width).toBe(8192)
    expect(item.height).toBe(4096)
  }
})

test('sample validation rejects rewritten bytes and unreviewed metadata', async () => {
  const changed = sampleBytes()
  changed[0] ^= 1
  await expect(validateVRTourSampleBytes(asset, changed)).rejects.toMatchObject({
    code: 'integrity'
  })
  await expect(validateVRTourSampleBytes({ ...asset }, sampleBytes())).rejects.toMatchObject({
    code: 'integrity'
  })
})

test('download uses only the exact reviewed source with no credentials or redirects', async () => {
  const fetcher = (async (input, init) => {
    expect(input).toBe(asset.downloadUrl)
    expect(init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store'
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return sampleResponse(asset)
  }) as VRTourSampleFetch
  expect(await downloadVRTourSampleAsset(asset, new AbortController().signal, fetcher)).toEqual(
    sampleBytes()
  )
})

test('invalid status, MIME, redirect and final source fail closed and cancel the response', async () => {
  for (const scenario of ['status', 'mime', 'redirect', 'source']) {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      }
    })
    const response = new Response(body, {
      status: scenario === 'status' ? 403 : 200,
      headers: { 'content-type': scenario === 'mime' ? 'text/html' : 'image/jpeg' }
    })
    if (scenario === 'redirect') Object.defineProperty(response, 'redirected', { value: true })
    if (scenario === 'source')
      Object.defineProperty(response, 'url', { value: 'https://unreviewed.example/house.jpg' })
    const fetcher = (async () => response) as VRTourSampleFetch
    await expect(
      downloadVRTourSampleAsset(asset, new AbortController().signal, fetcher)
    ).rejects.toMatchObject({ code: 'response' })
    expect(cancelled).toBe(true)
  }
})

test('download rejects declared, streamed and digest mismatches', async () => {
  for (const scenario of ['declared', 'short', 'large', 'digest']) {
    let bytes = sampleBytes()
    if (scenario === 'short') bytes = bytes.slice(0, -1)
    if (scenario === 'large') bytes = new Uint8Array(asset.byteLength + 1)
    if (scenario === 'digest') bytes[0] ^= 1
    const response = new Response(Uint8Array.from(bytes), {
      headers: { 'content-type': 'image/jpeg' }
    })
    if (scenario === 'declared') response.headers.set('content-length', '100')
    const fetcher = (async () => response) as VRTourSampleFetch
    await expect(
      downloadVRTourSampleAsset(asset, new AbortController().signal, fetcher)
    ).rejects.toMatchObject({
      code: scenario === 'digest' ? 'integrity' : 'size'
    })
  }
})

test('download distinguishes caller cancellation, timeout and network failure without leaking URLs', async () => {
  const blocked = (async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('private server details')), {
        once: true
      })
    })) as VRTourSampleFetch
  const controller = new AbortController()
  const cancelled = downloadVRTourSampleAsset(asset, controller.signal, blocked)
  controller.abort()
  await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
  await expect(
    downloadVRTourSampleAsset(asset, new AbortController().signal, blocked, 5)
  ).rejects.toMatchObject({ code: 'timeout' })
  const failing = (async () => {
    throw new Error('secret network details')
  }) as VRTourSampleFetch
  await expect(
    downloadVRTourSampleAsset(asset, new AbortController().signal, failing)
  ).rejects.toMatchObject({
    code: 'network',
    message: 'VR tour sample resources: network'
  })
})
