import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export type VRTourLocale = 'en' | 'zh-CN'

export interface VRTourHotspotV1 extends JSONObject {
  id: string
  label: string
  targetSceneId: string
  yaw: number
  pitch: number
}

export interface VRTourSceneV1 extends JSONObject {
  id: string
  title: string
  panoramaUrl: string
  hotspots: VRTourHotspotV1[]
}

export interface VRTourModuleConfigV1 extends JSONObject {
  /** Older version 1 documents omit this and retain the English interface. */
  locale?: VRTourLocale
  label: string
  scenes: VRTourSceneV1[]
  initialSceneId: string
  initialYaw: number
  initialPitch: number
  initialFov: number
  showControls: boolean
  showSceneList: boolean
  accentColor: string
  backgroundColor: string
  textColor: string
}

export type VRTourModuleConfig = VRTourModuleConfigV1
