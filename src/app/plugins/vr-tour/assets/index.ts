import { createVRTourSampleAssetManager } from './manager'
import { createVRTourSampleStorage } from './storage'
import type { VRTourSampleAssetManager, VRTourSampleAssetOptions } from './types'

let manager: VRTourSampleAssetManager | undefined
function sampleAssets(): VRTourSampleAssetManager {
  manager ??= createVRTourSampleAssetManager({ storage: createVRTourSampleStorage() })
  return manager
}

/** Explicit install/repair only. Opening a document must never call this automatically. */
export function ensureVRTourSampleAssets(options?: VRTourSampleAssetOptions) {
  return sampleAssets().ensure(options)
}

/** Cached bytes only; no network or implicit repair. */
export function getVRTourSampleAssets() {
  return sampleAssets().get()
}

/** Removes only plugin-owned cache; document images remain owned by their documents. */
export function removeVRTourSampleAssets() {
  return sampleAssets().remove()
}

export { vrTourSampleAssetCopy, vrTourSampleAssetErrorMessage } from './copy'
export { VRTourSampleAssetError } from './types'
export type { VRTourSampleAssetBytes, VRTourSampleAssetOptions } from './types'
