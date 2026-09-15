import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveVRTourModule, VR_TOUR_SAMPLE_ASSETS } from '#core/plugins/vr-tour'

/** Both clipboard carriers need media stored outside ordinary paint fields. */
export function collectClipboardNodeImageHashes(node: SceneNode, hashes: Set<string>): void {
  for (const fill of node.fills) {
    if (fill.imageHash) hashes.add(fill.imageHash)
  }
  if (node.type !== 'FRAME') return
  const resolved = resolveVRTourModule(node.interactiveProps?.module)
  if (!resolved?.ok) return
  const references = new Set(resolved.config.scenes.map((scene) => scene.panoramaUrl))
  for (const sample of VR_TOUR_SAMPLE_ASSETS) {
    if (references.has(sample.panoramaUrl)) hashes.add(sample.graphImageHash)
  }
}
