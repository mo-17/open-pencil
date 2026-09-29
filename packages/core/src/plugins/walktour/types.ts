import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export interface WalktourStep extends JSONObject {
  id: string
  title: string
  content: string
  targetChildName: string
  placement: 'top' | 'right' | 'bottom' | 'left'
}
export interface WalktourModuleConfigV1 extends JSONObject {
  triggerLabel: string
  steps: WalktourStep[]
  disabled: boolean
  showProgress: boolean
  showSkip: boolean
  panelWidth: number
  overlayOpacity: number
  triggerBackground: string
  triggerTextColor: string
  panelBackground: string
  textColor: string
  accentColor: string
  borderColor: string
  fontSize: number
  borderRadius: number
}
export const WALKTOUR_MODULE_LIMITS = Object.freeze({
  steps: 12,
  id: 48,
  title: 120,
  content: 2000,
  targetChildName: 120,
  configBytes: 49152
})
