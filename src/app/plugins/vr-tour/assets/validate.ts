import { VR_TOUR_SAMPLE_ASSETS, type VRTourSampleAsset } from '@open-pencil/core/plugins'
import { computeImageHash } from '@open-pencil/scene-graph/images'

import { VRTourSampleAssetError } from './types'

export async function validateVRTourSampleBytes(
  asset: VRTourSampleAsset,
  bytes: Uint8Array
): Promise<Uint8Array> {
  if (!VR_TOUR_SAMPLE_ASSETS.includes(asset)) throw new VRTourSampleAssetError('integrity')
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== asset.byteLength)
    throw new VRTourSampleAssetError('size')
  // Copy before awaiting so callers cannot mutate the bytes being verified.
  const copy = Uint8Array.from(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy))
  const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (sha256 !== asset.sha256 || computeImageHash(copy) !== asset.graphImageHash)
    throw new VRTourSampleAssetError('integrity')
  return copy
}
