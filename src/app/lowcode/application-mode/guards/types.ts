export type ApplicationGuardKind = 'enter' | 'leave'

export interface ApplicationGuardDraftValue {
  expression: string
  detail: string
}

export interface ApplicationGuardSource extends ApplicationGuardDraftValue {
  kind: ApplicationGuardKind
  version: number
  disabled: boolean
  configured: boolean
  detailValid: (value: unknown) => boolean
  commit: (value: ApplicationGuardDraftValue | undefined) => boolean
}

export interface ApplicationGuardPanelModel extends ApplicationGuardDraftValue {
  kind: ApplicationGuardKind
  version: number
  disabled: boolean
  configured: boolean
  dirty: boolean
  expressionValid: boolean
  detailValid: boolean
  canApply: boolean
  editExpression: (value: unknown) => boolean
  editDetail: (value: unknown) => boolean
  apply: () => boolean
  cancel: () => void
  remove: () => boolean
}
