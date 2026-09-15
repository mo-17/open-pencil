import { describe, expect, test } from 'bun:test'

import {
  createVRTourModuleInstance,
  resolveVRTourModule,
  VR_TOUR_MODULE_DEFAULT_CONFIG,
  VR_TOUR_MODULE_LIMITS
} from '@open-pencil/core/plugins'

import { reconcileInitialModuleItemId } from '@/app/plugins/module-items-editor-model'
import {
  addTourHotspot,
  addTourScene,
  cloneTourScenes,
  removeTourScene
} from '@/app/plugins/vr-tour/editor'

describe('VR room editor mutations', () => {
  test('deleting the initial room also removes incoming links and leaves a valid config', () => {
    const initial = VR_TOUR_MODULE_DEFAULT_CONFIG
    const scenes = removeTourScene(initial.scenes, initial.initialSceneId)
    const config = {
      ...initial,
      scenes,
      initialSceneId: reconcileInitialModuleItemId(scenes, initial.initialSceneId)
    }
    expect(scenes).toHaveLength(1)
    expect(scenes[0].hotspots).toEqual([])
    expect(resolveVRTourModule(createVRTourModuleInstance(config))?.ok).toBe(true)
    expect(initial.scenes).toHaveLength(2)
    expect(initial.scenes[0].hotspots).toHaveLength(1)
  })

  test('keeps one room and creates unique room/link identities without changing the original', () => {
    const original = cloneTourScenes(VR_TOUR_MODULE_DEFAULT_CONFIG.scenes)
    const next = addTourScene(original, 'Kitchen')
    const linked = addTourHotspot(next, 'room-1')
    expect(original).toHaveLength(2)
    expect(linked[2].hotspots[0]).toMatchObject({ targetSceneId: original[0].id, yaw: 0, pitch: 0 })
    const final = removeTourScene(removeTourScene(linked, original[0].id), original[1].id)
    expect(removeTourScene(final, 'room-1')).toEqual(final)
    expect(addTourHotspot(final, 'room-1')).toEqual(final)
    expect(resolveVRTourModule(createVRTourModuleInstance({ scenes: linked }))?.ok).toBe(true)
  })

  test('bounds room and hotspot insertion', () => {
    let scenes = cloneTourScenes(VR_TOUR_MODULE_DEFAULT_CONFIG.scenes)
    for (let index = 0; index < 20; index++) scenes = addTourScene(scenes, 'Room')
    expect(scenes).toHaveLength(VR_TOUR_MODULE_LIMITS.scenes)
    for (let index = 0; index < 200; index++)
      scenes = addTourHotspot(scenes, scenes[index % scenes.length].id)
    expect(scenes.reduce((sum, scene) => sum + scene.hotspots.length, 0)).toBe(
      VR_TOUR_MODULE_LIMITS.hotspotsTotal
    )
    expect(
      scenes.every((scene) => scene.hotspots.length <= VR_TOUR_MODULE_LIMITS.hotspotsPerScene)
    ).toBe(true)
  })
})
