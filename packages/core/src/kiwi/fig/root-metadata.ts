import { FIGMA_INTERACTION_MEDIA_MOTION_RAW_FIELD_KEYS } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

export const FIGMA_DOCUMENT_METADATA_FIELD_KEYS = [
  'strokeJoin',
  'strokeWeight',
  ...FIGMA_INTERACTION_MEDIA_MOTION_RAW_FIELD_KEYS
] as const satisfies readonly (keyof NodeChange)[]

export const FIGMA_CANVAS_METADATA_FIELD_KEYS = [
  'backgroundColor',
  'backgroundPaints',
  'guides',
  'strokeJoin',
  'strokeWeight',
  'pageType',
  ...FIGMA_INTERACTION_MEDIA_MOTION_RAW_FIELD_KEYS
] as const satisfies readonly (keyof NodeChange)[]
