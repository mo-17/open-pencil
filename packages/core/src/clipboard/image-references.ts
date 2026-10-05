import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveVRTourModule, VR_TOUR_SAMPLE_ASSETS } from '#core/plugins/vr-tour'

function collectPaintImageHashes(node: SceneNode, hashes: Set<string>): void {
  const paints = [node.fills, node.strokes, node.textDecorationFills]
  for (const run of node.styleRuns)
    paints.push(run.style.fills ?? [], run.style.textDecorationFills ?? [])
  for (const path of [...node.fillGeometry, ...node.strokeGeometry]) paints.push(path.fills ?? [])
  for (const override of Object.values(node.stateOverrides ?? {})) {
    paints.push(override.fills ?? [], override.strokes ?? [])
  }
  for (const override of Object.values(node.responsiveOverrides ?? {})) {
    paints.push(override.strokes ?? [])
  }
  for (const carrier of paints) {
    for (const paint of carrier) if (paint.imageHash) hashes.add(paint.imageHash)
  }
}

/** Both clipboard carriers need media stored outside ordinary paint fields. */
export function collectClipboardNodeImageHashes(node: SceneNode, hashes: Set<string>): void {
  collectPaintImageHashes(node, hashes)
  if (node.type !== 'FRAME') return
  const resolved = resolveVRTourModule(node.interactiveProps?.module)
  if (!resolved?.ok) return
  const references = new Set(resolved.config.scenes.map((scene) => scene.panoramaUrl))
  for (const sample of VR_TOUR_SAMPLE_ASSETS) {
    if (references.has(sample.panoramaUrl)) hashes.add(sample.graphImageHash)
  }
}
