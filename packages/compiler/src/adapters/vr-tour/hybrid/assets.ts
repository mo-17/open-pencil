import type { ComponentDef, IRTree } from '#compiler/ir/types'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

import { VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins'

interface HybridAsset {
  url: string
  mime: string
  byteLength: number
  sha256: string
  chunks: string[]
}

const CHUNK_BYTES = 1024 * 1024
const ASSET_PATH =
  /^public\/assets\/vr-tour\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/

export function collectHybridAssets(
  roots: readonly (IRTree | ComponentDef)[],
  configs: readonly Record<string, unknown>[],
  files: Map<string, string | Uint8Array>
): HybridAsset[] {
  const urls = new Set(
    configs.flatMap((config) =>
      Array.isArray(config.scenes)
        ? config.scenes.flatMap((scene: unknown) =>
            scene &&
            typeof scene === 'object' &&
            'panoramaUrl' in scene &&
            typeof scene.panoramaUrl === 'string'
              ? [scene.panoramaUrl]
              : []
          )
        : []
    )
  )
  const assets = new Map<string, HybridAsset>()
  let total = 0
  for (const asset of roots.flatMap((root) => root.assets ?? [])) {
    if (!ASSET_PATH.test(asset.path)) continue
    const url = asset.path.slice('public'.length)
    if (!urls.has(url)) continue
    const digest = bytesToHex(sha256(asset.bytes))
    const previous = assets.get(url)
    if (previous) {
      if (previous.sha256 !== digest) throw new Error('Conflicting VR hybrid asset path')
      continue
    }
    total += asset.bytes.byteLength
    if (
      !asset.bytes.byteLength ||
      asset.bytes.byteLength > 24 * CHUNK_BYTES ||
      total > 48 * CHUNK_BYTES
    )
      throw new RangeError('VR hybrid image budget exceeded')
    const chunks: string[] = []
    for (let offset = 0; offset < asset.bytes.byteLength; offset += CHUNK_BYTES) {
      const path = `assets/${digest}-${offset / CHUNK_BYTES}.bin`
      chunks.push(path)
      files.set('vr-tour-web/' + path, asset.bytes.slice(offset, offset + CHUNK_BYTES))
    }
    let mime = 'image/jpeg'
    if (url.endsWith('.png')) mime = 'image/png'
    else if (url.endsWith('.webp')) mime = 'image/webp'
    assets.set(url, { url, mime, byteLength: asset.bytes.byteLength, sha256: digest, chunks })
  }
  const samples = VR_TOUR_SAMPLE_ASSETS.filter(
    (sample) => assets.get(sample.panoramaUrl)?.sha256 === sample.sha256
  )
  if (samples.length)
    files.set(
      'vr-tour-web/SOURCES.json',
      JSON.stringify(
        {
          description:
            'Independent residential samples, not adjacent rooms. / 独立住宅示例，并非相邻房间。',
          samples: samples.map((sample) => ({
            id: sample.id,
            fileName: sample.fileName,
            author: sample.author,
            sourceUrl: sample.sourceUrl,
            license: sample.license,
            licenseUrl: sample.licenseUrl,
            sha256: sample.sha256,
            byteLength: sample.byteLength,
            width: sample.width,
            height: sample.height
          }))
        },
        null,
        2
      ) + '\n'
    )
  return [...assets.values()].sort((a, b) => {
    if (a.url < b.url) return -1
    return a.url > b.url ? 1 : 0
  })
}
