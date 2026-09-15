import { VR_TOUR_MODULE_LIMITS, type VRTourSceneV1 } from '@open-pencil/core/plugins'

import { nextModuleEditorItemId } from '../module-items-editor-model'

export function cloneTourScenes(scenes: readonly VRTourSceneV1[]): VRTourSceneV1[] {
  return scenes.map((scene) => ({
    ...scene,
    hotspots: scene.hotspots.map((hotspot) => ({ ...hotspot }))
  }))
}

export function addTourScene(scenes: readonly VRTourSceneV1[], title: string): VRTourSceneV1[] {
  const next = cloneTourScenes(scenes)
  if (next.length < VR_TOUR_MODULE_LIMITS.scenes)
    next.push({ id: nextModuleEditorItemId(next, 'room'), title, panoramaUrl: '', hotspots: [] })
  return next
}

/** Removing a room removes incoming links in the same document mutation. */
export function removeTourScene(scenes: readonly VRTourSceneV1[], id: string): VRTourSceneV1[] {
  if (scenes.length <= 1) return cloneTourScenes(scenes)
  return cloneTourScenes(scenes.filter((scene) => scene.id !== id)).map((scene) => ({
    ...scene,
    hotspots: scene.hotspots.filter((hotspot) => hotspot.targetSceneId !== id)
  }))
}

export function addTourHotspot(scenes: readonly VRTourSceneV1[], sceneId: string): VRTourSceneV1[] {
  const next = cloneTourScenes(scenes)
  const source = next.find((scene) => scene.id === sceneId)
  const target = next.find((scene) => scene.id !== sceneId)
  const total = next.reduce((count, scene) => count + scene.hotspots.length, 0)
  if (
    !source ||
    !target ||
    source.hotspots.length >= VR_TOUR_MODULE_LIMITS.hotspotsPerScene ||
    total >= VR_TOUR_MODULE_LIMITS.hotspotsTotal
  )
    return next
  source.hotspots.push({
    id: nextModuleEditorItemId(source.hotspots, 'door'),
    label: target.title,
    targetSceneId: target.id,
    yaw: 0,
    pitch: 0
  })
  return next
}
