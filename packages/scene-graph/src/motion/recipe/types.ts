import type { MotionStaggerDirection, MotionStaggerRhythm } from '../stagger'
import { MOTION_LIMITS, type MotionSpec, type MotionValidationIssue } from '../types'

export const MOTION_RECIPE_FORMAT = 'openpencil-motion-recipe' as const
export const MOTION_RECIPE_VERSION = 1 as const

export const MOTION_RECIPE_LIMITS = Object.freeze({
  maxRoles: 32,
  maxParameters: 16,
  maxBindingsPerRole: 64,
  maxTotalBindings: 256,
  maxAssignments: 512,
  maxIdLength: 64,
  maxNodeReferenceLength: 128,
  maxNameLength: 96,
  maxDescriptionLength: 512,
  parameterValue: Object.freeze({ min: -1_000_000, max: 1_000_000 })
})

export const MOTION_RECIPE_KEYFRAME_FIELD_LIMITS = {
  opacity: MOTION_LIMITS.opacity,
  x: MOTION_LIMITS.translate,
  y: MOTION_LIMITS.translate,
  scaleX: MOTION_LIMITS.scale,
  scaleY: MOTION_LIMITS.scale,
  rotate: MOTION_LIMITS.rotate,
  originX: MOTION_LIMITS.normalized,
  originY: MOTION_LIMITS.normalized,
  width: MOTION_LIMITS.dimension,
  height: MOTION_LIMITS.dimension,
  cornerRadius: MOTION_LIMITS.cornerRadius,
  strokeWidth: MOTION_LIMITS.strokeWidth,
  blur: MOTION_LIMITS.blur,
  shadowX: MOTION_LIMITS.shadowOffset,
  shadowY: MOTION_LIMITS.shadowOffset,
  shadowBlur: MOTION_LIMITS.blur,
  shadowSpread: MOTION_LIMITS.shadowSpread,
  pathProgress: MOTION_LIMITS.normalized,
  trimOffset: MOTION_LIMITS.trimOffset,
  gap: MOTION_LIMITS.layout,
  rowGap: MOTION_LIMITS.layout,
  columnGap: MOTION_LIMITS.layout,
  paddingTop: MOTION_LIMITS.layout,
  paddingRight: MOTION_LIMITS.layout,
  paddingBottom: MOTION_LIMITS.layout,
  paddingLeft: MOTION_LIMITS.layout
} as const

export type MotionRecipeKeyframeField = keyof typeof MOTION_RECIPE_KEYFRAME_FIELD_LIMITS
export type MotionRecipeTimingField = 'durationMs' | 'delayMs'

export interface MotionRecipeParameter {
  id: string
  defaultValue: number
  min: number
  max: number
}

export interface MotionRecipeTimingTarget {
  kind: 'timing'
  trackId: string
  field: MotionRecipeTimingField
}

export interface MotionRecipeKeyframeTarget {
  kind: 'keyframe'
  trackId: string
  keyframeIndex: number
  field: MotionRecipeKeyframeField
}

export type MotionRecipeBindingTarget = MotionRecipeTimingTarget | MotionRecipeKeyframeTarget

export interface MotionRecipeBinding {
  parameterId: string
  target: MotionRecipeBindingTarget
}

export interface MotionRecipeParameterReference {
  parameterId: string
}

export interface MotionRecipeStagger {
  stepMs: number | MotionRecipeParameterReference
  direction?: MotionStaggerDirection
  rhythm?: MotionStaggerRhythm
}

export interface MotionRecipeRole {
  id: string
  motion: MotionSpec
  bindings?: MotionRecipeBinding[]
  stagger?: MotionRecipeStagger
}

/** Portable authoring recipe. Runtime nodes continue to store only complete MotionSpec snapshots. */
export interface MotionRecipe {
  format: typeof MOTION_RECIPE_FORMAT
  version: typeof MOTION_RECIPE_VERSION
  id: string
  name: string
  description?: string
  parameters: MotionRecipeParameter[]
  roles: MotionRecipeRole[]
}

export interface MotionRecipeInstantiationInput {
  roleMapping: Record<string, readonly string[]>
  parameters?: Record<string, number>
}

export interface MotionRecipeAssignment {
  roleId: string
  nodeId: string
  motion: MotionSpec
}

export interface MotionRecipeInstantiation {
  recipeId: string
  recipeVersion: typeof MOTION_RECIPE_VERSION
  parameters: Record<string, number>
  assignments: MotionRecipeAssignment[]
}

export type MotionRecipeValidationResult =
  | { success: true; value: MotionRecipe }
  | { success: false; issues: MotionValidationIssue[] }
