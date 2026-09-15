import type { VRTourModuleConfigV1, VRTourSceneV1 } from './types'

export const VR_TOUR_PLUGIN_ID = 'open-pencil.vr-tour'
export const VR_TOUR_MODULE_TYPE = 'vr-tour'
export const VR_TOUR_MODULE_CONFIG_VERSION = 1
export const VR_TOUR_MODULE_DEFAULT_SIZE = Object.freeze({ width: 640, height: 400 })
export const VR_TOUR_MODULE_LIMITS = Object.freeze({
  scenes: 12,
  hotspotsPerScene: 24,
  hotspotsTotal: 128,
  id: 48,
  label: 120,
  url: 2_048,
  yawMin: -180,
  yawMax: 180,
  pitchMin: -85,
  pitchMax: 85,
  fovMin: 40,
  fovMax: 100,
  configBytes: 64 * 1024
})

const SCENES: VRTourSceneV1[] = [
  {
    id: 'living-room',
    title: 'Living room',
    panoramaUrl: '',
    hotspots: [
      { id: 'to-bedroom', label: 'Bedroom', targetSceneId: 'bedroom', yaw: 25, pitch: -10 }
    ]
  },
  {
    id: 'bedroom',
    title: 'Bedroom',
    panoramaUrl: '',
    hotspots: [
      {
        id: 'to-living-room',
        label: 'Living room',
        targetSceneId: 'living-room',
        yaw: -25,
        pitch: -10
      }
    ]
  }
]
for (const scene of SCENES) {
  scene.hotspots.forEach(Object.freeze)
  Object.freeze(scene.hotspots)
  Object.freeze(scene)
}
Object.freeze(SCENES)

export const VR_TOUR_MODULE_DEFAULT_CONFIG: Readonly<VRTourModuleConfigV1> = Object.freeze({
  locale: 'en',
  label: 'Property tour',
  scenes: SCENES,
  initialSceneId: 'living-room',
  initialYaw: 0,
  initialPitch: 0,
  initialFov: 75,
  showControls: true,
  showSceneList: true,
  accentColor: '#38BDF8',
  backgroundColor: '#0F172A',
  textColor: '#F8FAFC'
})

/** Localized defaults for a new insertion, never a translation of authored scene labels. */
export function createLocalizedVRTourConfig(locale: string): VRTourModuleConfigV1 {
  const config: VRTourModuleConfigV1 = structuredClone(VR_TOUR_MODULE_DEFAULT_CONFIG)
  if (!/^zh(?:-|$)/iu.test(locale)) return config
  config.locale = 'zh-CN'
  config.label = '房屋全景导览'
  for (const scene of config.scenes) {
    scene.title = scene.id === 'living-room' ? '客厅' : '卧室'
    for (const hotspot of scene.hotspots) {
      hotspot.label = hotspot.targetSceneId === 'living-room' ? '客厅' : '卧室'
    }
  }
  return config
}

/** Two independent residences to try; these links switch samples, not adjacent rooms. */
export function createVRTourSampleScenes(locale: string): VRTourSceneV1[] {
  const config = createLocalizedVRTourConfig(locale)
  const chinese = config.locale === 'zh-CN'
  for (const scene of config.scenes) {
    const sample = scene.id === 'living-room' ? 'A' : 'B'
    scene.title = (chinese ? '住宅示例 ' : 'Residential sample ') + sample
    scene.panoramaUrl =
      scene.id === 'living-room'
        ? '/assets/vr-tour/cayley_interior.jpg'
        : '/assets/vr-tour/lebombo.jpg'
    for (const hotspot of scene.hotspots) {
      const target = hotspot.targetSceneId === 'living-room' ? 'A' : 'B'
      hotspot.label = (chinese ? '切换示例 ' : 'Switch to sample ') + target
    }
  }
  return config.scenes
}
