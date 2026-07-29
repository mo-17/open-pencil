/** Public MotionSpec v1/v2/v3 API. */
export * from './motion/channels'
export * from './motion/clone'
export * from './motion/composition'
export * from './motion/drivers'
export * from './motion/generated-effect'
export * from './motion/identity'
export * from './motion/presets'
export * from './motion/recipe'
export * from './motion/recipe/instantiate'
export * from './motion/recipe/library'
export * from './motion/prototype'
export * from './motion/scene'
export * from './motion/shared-presets'
export * from './motion/shared-preset-source'
export * from './motion/stagger'
export * from './motion/team-library'
export * from './motion/team-library-keys'
export * from './motion/transition-key'
export * from './motion/types'
export * from './motion/user-presets'
export { MOTION_PORTABLE_VALUE_LIMITS } from './motion/validation-helpers'
export {
  MotionValidationError,
  cloneMotionSpec,
  isMotionSpec,
  parseMotionSpec,
  upgradeMotionSpecV2,
  upgradeMotionSpecV3,
  validateMotionSpec
} from './motion/validation'
