import type { Editor } from '@open-pencil/core/editor'
import type {
  LowcodeApplicationPageRole,
  LowcodeApplicationStateRetention,
  LowcodeApplicationEnterGuardV1,
  LowcodeApplicationLeaveConfirmV1
} from '@open-pencil/scene-graph'

import type { ApplicationGuardPanelModel } from './guards/types'
import type { ApplicationShellPanelModel } from './shell/types'

export type ApplicationModeEditor = Pick<
  Editor,
  'graph' | 'state' | 'updateNodeWithUndo' | 'onEditorEvent'
>

export type ApplicationModeOption = Record<'value' | 'label', string> &
  Partial<Record<'disabled', boolean>>

export interface ApplicationModeView {
  enabled: boolean
  role: LowcodeApplicationPageRole | ''
  entryId: string
  startId: string
  startRouteInvalid: boolean
  route: string
  stateRetention: LowcodeApplicationStateRetention | ''
  stateRetentionDisabled: boolean
  enterGuard?: LowcodeApplicationEnterGuardV1
  leaveConfirm?: LowcodeApplicationLeaveConfirmV1
  guardsDisabled: boolean
  invalid: boolean
  modeDisabled: boolean
  pageDisabled: boolean
  entryDisabled: boolean
  startDisabled: boolean
  routeDisabled: boolean
  entries: ApplicationModeOption[]
  starts: ApplicationModeOption[]
}

/** Controlled presentation and callbacks captured for one live editor/page revision. */
export interface ApplicationModePanelModel extends ApplicationModeView {
  version: number
  shell: ApplicationShellPanelModel
  enter: ApplicationGuardPanelModel
  leave: ApplicationGuardPanelModel
  setEnabled: (value: unknown) => boolean
  setRole: (value: unknown) => boolean
  setEntry: (value: unknown) => boolean
  setStart: (value: unknown) => boolean
  setRoute: (value: unknown) => boolean
  setStateRetention: (value: unknown) => boolean
}
