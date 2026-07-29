import { createMotionContractValidationHelpers } from './contract-validation'
import type { MotionValidationIssue } from './types'
import { MotionIssueValidationError } from './validation-helpers'

export const MOTION_TRANSITION_KEY_MAX_LENGTH = 64

export type MotionTransitionKey = string

export type MotionTransitionKeyValidationResult =
  | { success: true; value: MotionTransitionKey }
  | { success: false; issues: MotionValidationIssue[] }

export class MotionTransitionKeyValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'MotionTransitionKeyValidationError'
  }
}

const { safeId, text } = createMotionContractValidationHelpers(
  (issues) => new MotionTransitionKeyValidationError(issues)
)

/** Canonical explicit Smart Match identity. Matching never falls back to node names. */
export function parseMotionTransitionKey(value: unknown): MotionTransitionKey {
  return safeId(text(value, 'transitionKey', 1, MOTION_TRANSITION_KEY_MAX_LENGTH), 'transitionKey')
}

export function validateMotionTransitionKey(value: unknown): MotionTransitionKeyValidationResult {
  try {
    return { success: true, value: parseMotionTransitionKey(value) }
  } catch (error) {
    if (error instanceof MotionTransitionKeyValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}
