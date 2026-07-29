export { sampleMotionEasing, splitMotionEasing, type SplitMotionEasing } from './easing'
export {
  inspectMotionAdvancedChannels,
  inspectMotionNodeCapabilities,
  motionAdvancedChannelTemplate,
  motionAdvancedChannelTemplates,
  motionVectorTopologyId,
  projectMotionAdvancedChannels,
  type MotionAdvancedCapabilityCode,
  type MotionAdvancedCapabilityIssue,
  type MotionAdvancedChannel,
  type MotionAdvancedChannelTemplate,
  type MotionAdvancedProjectionResult,
  type MotionNodeCapabilityIssue,
  type MotionAdvancedValues
} from './advanced-channels'
export {
  MOTION_CUBIC_PATH_LOOKUP_STEPS,
  motionPathBoundaryProgresses,
  prepareMotionPath,
  sampleMotionPath,
  samplePreparedMotionPath,
  type MotionPathSample,
  type PreparedMotionPath
} from './path'
export {
  mapMotionDriverInput,
  normalizeMotionStateInput,
  type MotionInputValue
} from './driver/mapping'
export {
  inspectMotionDriverSourceBindings,
  motionDriverDocumentStates,
  motionDriverPageStates,
  motionDriverVariables,
  type MotionDriverSourceBindingCode,
  type MotionDriverSourceBindingIssue,
  type MotionDriverSourceGraph
} from './driver/sources'
export {
  generatedEffectNodeChanges,
  generatedEffectHash,
  graphHasAnimatedGeneratedEffects,
  sampleGeneratedEffect,
  type GeneratedEffectCirclePrimitive,
  type GeneratedEffectPrimitive,
  type GeneratedEffectRectPrimitive,
  type GeneratedEffectSample,
  type GeneratedEffectSampleOptions
} from './generated-effect'
export {
  prepareMotionDriverTarget,
  samplePreparedMotionDriverTarget,
  type MotionDriverPlanIssue,
  type MotionDriverPlanIssueCode,
  type MotionDriverTargetPreparation,
  type MotionDriverTargetSample,
  type MotionInputResolvedTarget,
  type MotionInputTargetResolver,
  type PreparedMotionDriverTarget,
  type PrepareMotionDriverTargetOptions
} from './driver/sampler'
export {
  MOTION_INPUT_CONTROLLER_LIMITS,
  MotionInputController,
  type MotionInputBatch,
  type MotionInputControllerOptions,
  type MotionInputFrameScheduler,
  type MotionInputInactiveOutput,
  type MotionInputKey,
  type MotionInputOutput,
  type MotionInputRegistration,
  type MotionInputSampleOutput,
  type MotionInputScopeCleanup,
  type MotionInputScopeState,
  type MotionInputTargetState
} from './input-controller'
export type { MotionResolvedTarget } from './resolved-target'
export {
  prepareMotionSamplingPlan,
  sampleMotionSpec,
  samplePreparedMotionPlan,
  samplePreparedMotionPlanWithDiagnostics
} from './sampler'
export {
  prepareMotionScenePlan,
  samplePreparedMotionScenePlan,
  type MotionScenePlanIssue,
  type MotionScenePlanIssueCode,
  type MotionSceneResolvedTarget,
  type MotionSceneSample,
  type MotionSceneTargetResolver,
  type PrepareMotionSceneOptions,
  type PreparedMotionSceneNodePlan,
  type PreparedMotionScenePlan
} from './scene'
export {
  applyMotionDirection,
  motionEndProgress,
  preparedMotionPlanDuration,
  resolveMotionTrackIterations
} from './timing'
export {
  MOTION_VISUAL_IDENTITY,
  type MotionDiagnosticSample,
  type MotionSample,
  type MotionSampleOptions,
  type MotionSamplingSelection,
  type MotionTrackSampleDiagnostic,
  type PrepareMotionSamplingOptions,
  type PreparedMotionComposition,
  type PreparedMotionSamplingPlan,
  type PreparedMotionTrack,
  type MotionVisualState
} from './types'
