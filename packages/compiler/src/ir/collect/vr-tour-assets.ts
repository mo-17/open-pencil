import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

import {
  VR_TOUR_MODULE_TYPE,
  VR_TOUR_PLUGIN_ID,
  VR_TOUR_SAMPLE_ASSETS,
  resolveVRTourModule
} from '@open-pencil/core/plugins'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { IRAsset, IRModule, IRWarning } from '../types'

/** Aggregate the final project so page/component source manifests cannot overwrite one another. */
export function emitVRTourSampleSources(files: Map<string, string | Uint8Array>): void {
  const samples = VR_TOUR_SAMPLE_ASSETS.filter(
    (sample) => files.get('public' + sample.panoramaUrl) instanceof Uint8Array
  )
  if (samples.length === 0) return
  const path = 'public/assets/vr-tour/SOURCES.json'
  const source = {
    version: 1,
    description: 'These are independent residential samples, not adjacent rooms.',
    descriptionZh: '这些图片展示独立住宅示例，并非同一住宅的相邻房间。',
    samples: samples.map((sample) => ({
      id: sample.id,
      fileName: sample.fileName,
      panoramaUrl: sample.panoramaUrl,
      sha256: sample.sha256,
      byteLength: sample.byteLength,
      width: sample.width,
      height: sample.height,
      author: sample.author,
      sourceUrl: sample.sourceUrl,
      license: sample.license,
      licenseUrl: sample.licenseUrl
    }))
  }
  files.set(path, new TextEncoder().encode(JSON.stringify(source, null, 2) + '\n'))
}

/** Export only referenced, pinned samples already persisted in this document. No network IO. */
export function collectVRTourSampleAssets(
  nodeId: string,
  module: IRModule | null,
  graph: SceneGraph,
  assets: Map<string, IRAsset>,
  warnings: IRWarning[]
): void {
  if (module?.pluginId !== VR_TOUR_PLUGIN_ID || module.moduleType !== VR_TOUR_MODULE_TYPE) return
  const resolved = resolveVRTourModule({
    version: 1,
    pluginId: module.pluginId,
    moduleType: module.moduleType,
    configVersion: module.configVersion,
    config: module.payload
  })
  if (!resolved?.ok) return
  const references = new Set(resolved.config.scenes.map((scene) => scene.panoramaUrl))
  for (const sample of VR_TOUR_SAMPLE_ASSETS) {
    if (!references.has(sample.panoramaUrl)) continue
    const path = 'public' + sample.panoramaUrl
    if (assets.has(path)) continue
    const bytes = graph.images.get(sample.graphImageHash)
    if (!bytes) {
      warnings.push({
        code: 'vr-tour-sample-missing',
        message: `VR sample ${sample.id} is not saved in this document. Apply the installed sample images before exporting.`,
        nodeId
      })
      continue
    }
    if (bytes.byteLength !== sample.byteLength || bytesToHex(sha256(bytes)) !== sample.sha256) {
      warnings.push({
        code: 'vr-tour-sample-integrity-invalid',
        message: `VR sample ${sample.id} does not match its pinned image bytes. Reapply the installed sample images before exporting.`,
        nodeId
      })
      continue
    }
    assets.set(path, { path, bytes })
  }
}
