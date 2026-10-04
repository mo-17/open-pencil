import type { LowcodeApplicationShellV1 } from '@open-pencil/scene-graph'

import type { ApplicationModeOption } from '../types'

export interface ApplicationShellView {
  frameNodeId: string
  slotNodeId: string
  configured: boolean
  invalid: boolean
  disabled: boolean
  frames: ApplicationModeOption[]
}

export interface ApplicationShellSource extends ApplicationShellView {
  version: number
  getSlots: (frameNodeId: string) => ApplicationModeOption[]
  eligible: (frameNodeId: string, slotNodeId: string) => boolean
  commit: (shell: LowcodeApplicationShellV1 | undefined) => boolean
}

export interface ApplicationShellPanelModel extends ApplicationShellView {
  version: number
  slots: ApplicationModeOption[]
  dirty: boolean
  canApply: boolean
  selectFrame: (value: unknown) => boolean
  selectSlot: (value: unknown) => boolean
  apply: () => boolean
  cancel: () => void
  remove: () => boolean
}
