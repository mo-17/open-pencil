import { VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins'

import { downloadVRTourSampleAsset, type VRTourSampleFetch } from './download'
import {
  VRTourSampleAssetError,
  type VRTourSampleAssetBytes,
  type VRTourSampleAssetManager,
  type VRTourSampleAssetStorage
} from './types'
import { validateVRTourSampleBytes } from './validate'

export interface VRTourSampleAssetManagerOptions {
  storage: VRTourSampleAssetStorage
  fetcher?: VRTourSampleFetch
}

export function createVRTourSampleAssetManager(
  options: VRTourSampleAssetManagerOptions
): VRTourSampleAssetManager {
  const { storage } = options
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  let generation = 0
  let active: AbortController | null = null
  let tail: Promise<void> = Promise.resolve()

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation)
    tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async function readVerified(
    asset: (typeof VR_TOUR_SAMPLE_ASSETS)[number]
  ): Promise<Uint8Array | null> {
    let bytes: Uint8Array | null
    try {
      bytes = await storage.read(asset)
    } catch {
      throw new VRTourSampleAssetError('storage')
    }
    if (bytes === null) return null
    try {
      return await validateVRTourSampleBytes(asset, bytes)
    } catch {
      return null
    }
  }

  async function readPack(): Promise<readonly VRTourSampleAssetBytes[] | null> {
    const entries: VRTourSampleAssetBytes[] = []
    for (const asset of VR_TOUR_SAMPLE_ASSETS) {
      const bytes = await readVerified(asset)
      if (!bytes) return null
      entries.push({ asset, bytes })
    }
    return entries
  }

  return {
    get() {
      return enqueue(readPack)
    },
    ensure({ signal } = {}) {
      // Capture when requested, not when dequeued: uninstall invalidates queued repairs too.
      const requestedGeneration = generation
      return enqueue(async () => {
        const controller = new AbortController()
        const abort = () => controller.abort()
        signal?.addEventListener('abort', abort, { once: true })
        active = controller
        const assertCurrent = () => {
          if (signal?.aborted || controller.signal.aborted || requestedGeneration !== generation)
            throw new VRTourSampleAssetError('cancelled')
        }
        try {
          assertCurrent()
          for (const asset of VR_TOUR_SAMPLE_ASSETS) {
            const cached = await readVerified(asset)
            assertCurrent()
            if (cached) continue
            const bytes = await downloadVRTourSampleAsset(asset, controller.signal, fetcher)
            assertCurrent()
            try {
              await storage.write(asset, bytes)
            } catch {
              throw new VRTourSampleAssetError('storage')
            }
            assertCurrent()
          }
          // Installation is ready only after durable readback validates the whole pack.
          const persisted = await readPack()
          assertCurrent()
          if (!persisted) throw new VRTourSampleAssetError('storage')
          return persisted
        } finally {
          signal?.removeEventListener('abort', abort)
          if (active === controller) active = null
        }
      })
    },
    remove() {
      generation += 1
      active?.abort()
      // Wait for any in-progress native write, then remove. It cannot repopulate after removal.
      return enqueue(async () => {
        try {
          await storage.remove()
        } catch {
          throw new VRTourSampleAssetError('storage')
        }
      })
    }
  }
}
