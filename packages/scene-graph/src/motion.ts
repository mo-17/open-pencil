/** Public MotionSpec v1 API. */
export * from './motion/channels'
export * from './motion/presets'
export * from './motion/types'
export {
  MotionValidationError,
  cloneMotionSpec,
  isMotionSpec,
  parseMotionSpec,
  validateMotionSpec
} from './motion/validation'
