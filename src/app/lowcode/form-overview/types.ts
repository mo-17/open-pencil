import type { FormControlBindingStatus } from '@open-pencil/lowcode'

export interface FormOverviewTarget {
  nodeId: string
  section: 'lowcode-bindings' | 'lowcode-control' | 'lowcode-validation' | 'lowcode-events'
  actionPath?: string
  actionId?: string
}

export interface FormOverviewField {
  id: string
  name: string
  valueKey?: 'value' | 'endValue'
  binding: FormControlBindingStatus
  validation: 'none' | 'configured' | 'invalid'
  asynchronous: boolean
}

export interface FormSubmissionOverview {
  actions: number
  requests: number
  handled: number
  invalidTargets: number
  customFailure: boolean
  workflow: boolean
  truncated: boolean
  attentionPath?: string
  attentionActionId?: string
}

export interface FormOverview {
  formId: string
  name: string
  fields: FormOverviewField[]
  clickButtons: Array<{ id: string; name: string; actionId: string }>
  submission: FormSubmissionOverview
  truncated: boolean
}
