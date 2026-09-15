import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { VR_TOUR_SAMPLE_ASSETS, type VRTourSampleAsset } from '@open-pencil/core/plugins'

import type { VRTourSampleFetch } from '@/app/plugins/vr-tour/assets/download'
import type { VRTourSampleAssetStorage } from '@/app/plugins/vr-tour/assets/types'

const fixtures = new Map(
  VR_TOUR_SAMPLE_ASSETS.map((asset) => [
    asset.id,
    new Uint8Array(readFileSync(resolve('packages/demos/vr-tour', asset.fileName)))
  ])
)

export function sampleBytes(asset = VR_TOUR_SAMPLE_ASSETS[0]): Uint8Array {
  const bytes = fixtures.get(asset.id)
  if (!bytes) throw new Error('Missing sample fixture')
  return Uint8Array.from(bytes)
}

export function sampleResponse(asset: VRTourSampleAsset, bytes = sampleBytes(asset)): Response {
  return new Response(Uint8Array.from(bytes), {
    headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.byteLength) }
  })
}

export function sampleFetcher(onFetch?: (asset: VRTourSampleAsset) => void): VRTourSampleFetch {
  return (async (input) => {
    const asset = VR_TOUR_SAMPLE_ASSETS.find((candidate) => candidate.downloadUrl === input)
    if (!asset) throw new Error('Unexpected sample URL')
    onFetch?.(asset)
    return sampleResponse(asset)
  }) as VRTourSampleFetch
}

export function sampleStorage() {
  const rows = new Map<string, Uint8Array>()
  const storage: VRTourSampleAssetStorage = {
    async read(asset) {
      const bytes = rows.get(asset.id)
      return bytes ? Uint8Array.from(bytes) : null
    },
    async write(asset, bytes) {
      rows.set(asset.id, Uint8Array.from(bytes))
    },
    async remove() {
      rows.clear()
    }
  }
  return { rows, storage }
}

export function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
