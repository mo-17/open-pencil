import { IS_TAURI } from '@open-pencil/core/constants'
import {
  VR_TOUR_SAMPLE_ASSETS,
  VR_TOUR_SAMPLE_PACK_DIGEST,
  type VRTourSampleAsset
} from '@open-pencil/core/plugins'

import { readCacheBytes, removeCachePrefix, writeCacheBytes } from '@/app/cache'
import { openIdb, reqToPromise, txDone } from '@/app/storage/idb'

import { VRTourSampleAssetError, type VRTourSampleAssetStorage } from './types'

const CACHE_PREFIX = `vr-tour/${VR_TOUR_SAMPLE_PACK_DIGEST}`
export const VR_TOUR_SAMPLE_DATABASE_NAME = 'open-pencil-vr-tour-samples-v1'
const STORE = 'assets'

function assetKey(asset: VRTourSampleAsset): string {
  if (!VR_TOUR_SAMPLE_ASSETS.includes(asset)) throw new VRTourSampleAssetError('integrity')
  return `${CACHE_PREFIX}/${asset.sha256}.jpg`
}

export function createNativeVRTourSampleStorage(): VRTourSampleAssetStorage {
  return {
    async read(asset) {
      const bytes = await readCacheBytes(assetKey(asset))
      return bytes === null ? null : new Uint8Array(bytes)
    },
    async write(asset, bytes) {
      await writeCacheBytes(assetKey(asset), Uint8Array.from(bytes).buffer)
    },
    async remove() {
      await removeCachePrefix(CACHE_PREFIX)
      for (const asset of VR_TOUR_SAMPLE_ASSETS) {
        if ((await readCacheBytes(assetKey(asset))) !== null)
          throw new VRTourSampleAssetError('storage')
      }
    }
  }
}

export function createIdbVRTourSampleStorage(
  databaseName = VR_TOUR_SAMPLE_DATABASE_NAME,
  idbFactory?: IDBFactory
): VRTourSampleAssetStorage {
  const open = () =>
    openIdb(databaseName, 1, (database) => database.createObjectStore(STORE), idbFactory)
  return {
    async read(asset) {
      const key = assetKey(asset)
      const database = await open()
      try {
        const transaction = database.transaction(STORE, 'readonly')
        const complete = txDone(transaction)
        const result: unknown = await reqToPromise(transaction.objectStore(STORE).get(key))
        await complete
        return result instanceof ArrayBuffer ? new Uint8Array(result) : null
      } finally {
        database.close()
      }
    },
    async write(asset, bytes) {
      const key = assetKey(asset)
      const database = await open()
      try {
        const transaction = database.transaction(STORE, 'readwrite')
        const complete = txDone(transaction)
        transaction.objectStore(STORE).put(Uint8Array.from(bytes).buffer, key)
        await complete
      } finally {
        database.close()
      }
    },
    async remove() {
      const database = await open()
      try {
        const transaction = database.transaction(STORE, 'readwrite')
        const complete = txDone(transaction)
        transaction.objectStore(STORE).clear()
        await complete
      } finally {
        database.close()
      }
    }
  }
}

export function createVRTourSampleStorage(): VRTourSampleAssetStorage {
  return IS_TAURI ? createNativeVRTourSampleStorage() : createIdbVRTourSampleStorage()
}
