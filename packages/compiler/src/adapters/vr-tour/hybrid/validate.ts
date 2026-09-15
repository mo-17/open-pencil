import {
  isReviewedMiniProgramRasterAsset,
  MINIPROGRAM_PROJECT_LIMITS
} from '#compiler/adapters/miniprogram-shared'
import type { IRAsset, IRElement, IRTree } from '#compiler/ir/types'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import * as v from 'valibot'

import {
  VR_TOUR_MODULE_TYPE,
  VR_TOUR_PLUGIN_ID,
  VR_TOUR_SAMPLE_ASSETS,
  resolveVRTourModule
} from '@open-pencil/core/plugins'

import { emitVRTourHybridProject, vrTourHybridKey } from './index'

const PREFIX = 'vr-tour-web/'
const MANIFEST_PATH = PREFIX + 'manifest.json'
const CHUNK_BYTES = 1024 * 1024
const IMAGE_URL = /^\/assets\/vr-tour\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/
const TOUR_SCHEMA = v.strictObject({
  sourceId: v.pipe(v.string(), v.minLength(1), v.maxLength(256), v.regex(/^[^\p{Cc}\p{Cf}]+$/u)),
  key: v.pipe(v.string(), v.regex(/^tour-[a-f0-9]{32}$/)),
  config: v.record(v.string(), v.unknown())
})
const ASSET_SCHEMA = v.strictObject({
  url: v.pipe(v.string(), v.maxLength(2048), v.regex(IMAGE_URL)),
  mime: v.picklist(['image/jpeg', 'image/png', 'image/webp']),
  byteLength: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(24 * CHUNK_BYTES)),
  sha256: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
  chunks: v.pipe(v.array(v.pipe(v.string(), v.maxLength(100))), v.minLength(1), v.maxLength(24))
})
const MANIFEST_SCHEMA = v.strictObject({
  version: v.literal(1),
  target: v.literal('taro'),
  tours: v.pipe(v.array(TOUR_SCHEMA), v.minLength(1), v.maxLength(100)),
  assets: v.pipe(v.array(ASSET_SCHEMA), v.maxLength(MINIPROGRAM_PROJECT_LIMITS.maxAssets))
})
type HybridManifest = v.InferOutput<typeof MANIFEST_SCHEMA>
type HybridAsset = v.InferOutput<typeof ASSET_SCHEMA>

export interface ReviewedTaroVRTourHybridArtifacts {
  /** Exact files regenerated from validated data, not a directory-prefix exemption. */
  paths: ReadonlySet<string>
  /** Authored data still needs the host's credential and local-path checks. */
  manifest: string
  /** Whole non-pinned images allow metadata checks to span chunk boundaries.
   * The two repository-reviewed public samples are matched by actual SHA256
   * and length; scanning their compressed entropy produces false positives. */
  images: readonly Uint8Array[]
}

function invalid(): never {
  throw new Error('Taro VR sidecar failed compiler verification')
}

function sidecarFiles(
  files: ReadonlyMap<string, string | Uint8Array>
): Map<string, string | Uint8Array> {
  const result = new Map<string, string | Uint8Array>()
  let total = 0
  for (const [path, content] of files) {
    if (!path.startsWith(PREFIX)) continue
    const length =
      typeof content === 'string' ? new TextEncoder().encode(content).length : content.byteLength
    total += length
    if (
      path.length > MINIPROGRAM_PROJECT_LIMITS.maxPathBytes ||
      length > CHUNK_BYTES ||
      total > MINIPROGRAM_PROJECT_LIMITS.maxAggregateBytes ||
      result.size >= MINIPROGRAM_PROJECT_LIMITS.maxFiles
    )
      invalid()
    result.set(path, content)
  }
  return result
}

function tourNodes(value: HybridManifest['tours']): IRElement[] {
  const ids = new Set<string>()
  return value.map((tour): IRElement => {
    const sourceId = tour.sourceId
    if (ids.has(sourceId) || tour.key !== vrTourHybridKey(sourceId)) invalid()
    ids.add(sourceId)
    const config = tour.config
    const resolved = resolveVRTourModule({
      version: 1,
      pluginId: VR_TOUR_PLUGIN_ID,
      moduleType: VR_TOUR_MODULE_TYPE,
      configVersion: 1,
      config
    })
    if (!resolved?.ok) invalid()
    return {
      kind: 'element',
      sourceId,
      tag: 'div',
      className: '',
      attrs: {},
      children: [],
      module: {
        pluginId: VR_TOUR_PLUGIN_ID,
        moduleType: VR_TOUR_MODULE_TYPE,
        configVersion: 1,
        payload: config
      }
    }
  })
}

function imageBytes(
  asset: HybridAsset,
  files: ReadonlyMap<string, string | Uint8Array>
): Uint8Array {
  const { sha256: digest, byteLength, chunks } = asset
  if (chunks.length !== Math.ceil(byteLength / CHUNK_BYTES)) invalid()
  const bytes = new Uint8Array(byteLength)
  for (let index = 0; index < chunks.length; index++) {
    const path = `assets/${digest}-${index}.bin`
    if (chunks[index] !== path) invalid()
    const chunk = files.get(PREFIX + path)
    if (
      !(chunk instanceof Uint8Array) ||
      chunk.byteLength !== Math.min(CHUNK_BYTES, byteLength - index * CHUNK_BYTES)
    )
      invalid()
    bytes.set(chunk, index * CHUNK_BYTES)
  }
  if (bytesToHex(sha256(bytes)) !== digest) invalid()
  return bytes
}

function imageAssets(
  value: HybridAsset[],
  files: ReadonlyMap<string, string | Uint8Array>
): IRAsset[] {
  const urls = new Set<string>()
  let total = 0
  return value.map((asset): IRAsset => {
    if (urls.has(asset.url)) invalid()
    urls.add(asset.url)
    let mime = 'image/jpeg'
    if (asset.url.endsWith('.png')) mime = 'image/png'
    else if (asset.url.endsWith('.webp')) mime = 'image/webp'
    if (asset.mime !== mime) invalid()
    total += asset.byteLength
    if (!Number.isSafeInteger(total) || total > 48 * CHUNK_BYTES) invalid()
    const bytes = imageBytes(asset, files)
    if (!isReviewedMiniProgramRasterAsset(asset.url, bytes)) invalid()
    return { path: 'public' + asset.url, bytes }
  })
}

function regenerationTree(children: IRElement[], assets: IRAsset[]): IRTree {
  return {
    pageId: 'vr-tour-review',
    pageName: 'VR tour review',
    usesRouteParams: false,
    children,
    assets,
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    warnings: []
  }
}

function identical(left: string | Uint8Array, right: string | Uint8Array | undefined): boolean {
  if (typeof left === 'string') return left === right
  return (
    right instanceof Uint8Array &&
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  )
}

/**
 * Accept only the complete source sidecar emitted by this compiler for Taro.
 * Rebuild its source templates, closed manifest and chunk/provenance files from
 * bounded validated data. Unknown, missing and modified files fail closed.
 * This does not approve arbitrary HTML, native project files or installed packages.
 */
export function reviewTaroVRTourHybridArtifacts(
  files: ReadonlyMap<string, string | Uint8Array>
): ReviewedTaroVRTourHybridArtifacts | undefined {
  const candidates = sidecarFiles(files)
  if (!candidates.size) return undefined
  const source = candidates.get(MANIFEST_PATH)
  if (typeof source !== 'string') invalid()
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    invalid()
  }
  const result = v.safeParse(MANIFEST_SCHEMA, parsed)
  if (!result.success) invalid()
  const manifest = result.output
  const children = tourNodes(manifest.tours)
  const assets = imageAssets(manifest.assets, candidates)
  const expected = emitVRTourHybridProject([regenerationTree(children, assets)], [], 'taro').files
  if (expected.size !== candidates.size) invalid()
  for (const [path, content] of expected) {
    if (!identical(content, candidates.get(path))) invalid()
  }
  return {
    paths: new Set(expected.keys()),
    manifest: source,
    images: assets
      .map((asset) => asset.bytes)
      .filter((bytes) => {
        const digest = bytesToHex(sha256(bytes))
        return !VR_TOUR_SAMPLE_ASSETS.some(
          (sample) => sample.byteLength === bytes.byteLength && sample.sha256 === digest
        )
      })
  }
}
