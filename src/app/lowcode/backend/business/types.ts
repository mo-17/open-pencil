import type { Editor } from '@open-pencil/core/editor'

import type { BusinessTemplateId } from './model/types'

export type BusinessTemplateEditor = Pick<
  Editor,
  'graph' | 'createShape' | 'updateNodeWithUndo' | 'undo'
>

export interface BusinessText {
  readonly en: string
  readonly zh: string
}

export interface BusinessColumn {
  readonly field: string
  readonly label: BusinessText
  readonly multiline?: boolean
}

export interface BusinessChoice {
  readonly value: string | boolean
  readonly label: BusinessText
}

export interface BusinessRelation {
  readonly resourceId: string
  readonly labelField: string
  readonly valueField?: string
  readonly columns?: readonly BusinessColumn[]
  readonly filters?: Readonly<Record<string, BusinessParameterSource>>
}

/** Reviewed local metadata describes controls, never client code or permission grants. */
export interface BusinessInput {
  readonly key: string
  readonly label: BusinessText
  readonly kind: 'text' | 'textarea' | 'number' | 'select' | 'relation'
  readonly required?: boolean
  readonly maxLength?: number
  readonly min?: number
  readonly max?: number
  readonly choices?: readonly BusinessChoice[]
  readonly relation?: BusinessRelation
  readonly initial?: string | number
  readonly fromSelection?: string
}

export type BusinessParameterSource =
  | { readonly kind: 'input'; readonly key: string }
  | { readonly kind: 'selection'; readonly field: string }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }

export interface BusinessActionCondition {
  readonly field: string
  readonly values: readonly (string | boolean)[]
}

/** One selected-field match, or up to four simultaneous matches; never authored code. */
export type BusinessActionWhen =
  | BusinessActionCondition
  | { readonly all: readonly BusinessActionCondition[] }

export interface BusinessActionDefinition {
  readonly id: string
  readonly label: BusinessText
  readonly description: BusinessText
  readonly commandId: string
  readonly inputs: readonly BusinessInput[]
  readonly parameters: Readonly<Record<string, BusinessParameterSource>>
  readonly when?: BusinessActionWhen
}

export interface BusinessListing {
  readonly resourceId: string
  readonly columns: readonly BusinessColumn[]
  readonly search?: boolean
  readonly filter?: { readonly field: string; readonly choices: readonly BusinessChoice[] }
}

export interface BusinessRelatedListing extends BusinessListing {
  readonly title: BusinessText
  readonly foreignKey: string
  /** Field on the selected parent record to match; defaults to its id. */
  readonly selectionField?: string
}

export interface BusinessVideoPlayer {
  readonly srcField: string
  readonly posterField: string
}

export interface BusinessPageDefinition {
  readonly id: string
  readonly path: string
  readonly title: BusinessText
  readonly description: BusinessText
  readonly public?: boolean
  readonly listing?: BusinessListing
  readonly details?: readonly BusinessColumn[]
  /** Selected record's safe panorama URL, passed through the reviewed VR module binding. */
  readonly vrTourField?: string
  /** Selected record supplies public playback URLs, never stream credentials or player code. */
  readonly videoPlayer?: BusinessVideoPlayer
  readonly related?: readonly BusinessRelatedListing[]
  readonly actions: readonly BusinessActionDefinition[]
}

export interface BusinessTemplateDefinition {
  readonly id: BusinessTemplateId
  readonly title: BusinessText
  readonly description: BusinessText
  readonly entryPage: string
  readonly roles: readonly string[]
  readonly pages: readonly BusinessPageDefinition[]
}

export const businessText = (en: string, zh: string): BusinessText => ({ en, zh })

export function businessLabel(text: BusinessText, locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? text.zh : text.en
}
