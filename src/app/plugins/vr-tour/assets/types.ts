import type { VRTourSampleAsset } from '@open-pencil/core/plugins'

export interface VRTourSampleAssetBytes {
  readonly asset: VRTourSampleAsset
  readonly bytes: Uint8Array
}

export interface VRTourSampleAssetStorage {
  read(asset: VRTourSampleAsset): Promise<Uint8Array | null>
  write(asset: VRTourSampleAsset, bytes: Uint8Array): Promise<void>
  remove(): Promise<void>
}

export type VRTourSampleAssetErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'response'
  | 'size'
  | 'integrity'
  | 'storage'

export class VRTourSampleAssetError extends Error {
  constructor(readonly code: VRTourSampleAssetErrorCode) {
    super(`VR tour sample resources: ${code}`)
    this.name = 'VRTourSampleAssetError'
  }
}

export interface VRTourSampleAssetOptions {
  signal?: AbortSignal
}

export interface VRTourSampleAssetManager {
  get(): Promise<readonly VRTourSampleAssetBytes[] | null>
  ensure(options?: VRTourSampleAssetOptions): Promise<readonly VRTourSampleAssetBytes[]>
  remove(): Promise<void>
}
