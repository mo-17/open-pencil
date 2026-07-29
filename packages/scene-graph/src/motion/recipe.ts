import { createMotionContractValidationHelpers } from './contract-validation'
import {
  MOTION_RECIPE_FORMAT,
  MOTION_RECIPE_KEYFRAME_FIELD_LIMITS,
  MOTION_RECIPE_LIMITS,
  MOTION_RECIPE_VERSION,
  type MotionRecipe,
  type MotionRecipeBinding,
  type MotionRecipeBindingTarget,
  type MotionRecipeKeyframeField,
  type MotionRecipeParameter,
  type MotionRecipeParameterReference,
  type MotionRecipeRole,
  type MotionRecipeStagger,
  type MotionRecipeTimingField,
  type MotionRecipeValidationResult
} from './recipe/types'
import {
  MOTION_STAGGER_DIRECTIONS,
  MOTION_STAGGER_RHYTHMS,
  type MotionStaggerDirection,
  type MotionStaggerRhythm
} from './stagger'
import { MOTION_LIMITS, type MotionSpec, type MotionValidationIssue } from './types'
import { cloneMotionSpec, MotionValidationError, parseMotionSpec } from './validation'
import {
  assertMotionPortableValue,
  MotionIssueValidationError,
  remapMotionIssuePaths
} from './validation-helpers'

export * from './recipe/types'

export class MotionRecipeValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'MotionRecipeValidationError'
  }
}

const TIMING_FIELDS = new Set<MotionRecipeTimingField>(['durationMs', 'delayMs'])
const KEYFRAME_FIELDS = new Set<MotionRecipeKeyframeField>(
  Object.keys(MOTION_RECIPE_KEYFRAME_FIELD_LIMITS) as MotionRecipeKeyframeField[]
)
const STAGGER_DIRECTIONS = new Set<MotionStaggerDirection>(MOTION_STAGGER_DIRECTIONS)
const STAGGER_RHYTHMS = new Set<MotionStaggerRhythm>(MOTION_STAGGER_RHYTHMS)

const { boundedNumber, invalid, plainRecord, required, safeId, strictRecord, text } =
  createMotionContractValidationHelpers((issues) => new MotionRecipeValidationError(issues))

function integer(value: unknown, path: string, min: number, max: number): number {
  const number = boundedNumber(value, path, min, max)
  if (!Number.isInteger(number)) return invalid(path, 'invalid_value', 'Expected an integer')
  return number
}

function parseParameter(value: unknown, path: string): MotionRecipeParameter {
  const record = strictRecord(value, path, ['id', 'defaultValue', 'min', 'max'])
  const min = boundedNumber(
    required(record, 'min', path),
    `${path}.min`,
    MOTION_RECIPE_LIMITS.parameterValue.min,
    MOTION_RECIPE_LIMITS.parameterValue.max
  )
  const max = boundedNumber(
    required(record, 'max', path),
    `${path}.max`,
    MOTION_RECIPE_LIMITS.parameterValue.min,
    MOTION_RECIPE_LIMITS.parameterValue.max
  )
  if (min > max) return invalid(path, 'invalid_value', 'Parameter min must not exceed max')
  return {
    id: safeId(required(record, 'id', path), `${path}.id`),
    defaultValue: boundedNumber(
      required(record, 'defaultValue', path),
      `${path}.defaultValue`,
      min,
      max
    ),
    min,
    max
  }
}

function remapMotionError(error: unknown, path: string): never {
  if (!(error instanceof MotionValidationError)) throw error
  throw new MotionRecipeValidationError(remapMotionIssuePaths(error.issues, path))
}

function parsePortableMotion(value: unknown, path: string): MotionSpec {
  let motion: MotionSpec
  try {
    motion = parseMotionSpec(value)
  } catch (error) {
    return remapMotionError(error, path)
  }
  if (motion.preset !== undefined) {
    return invalid(
      `${path}.preset`,
      'invalid_value',
      'Recipe role motion must be a complete snapshot'
    )
  }
  return motion
}

function parseBindingTarget(value: unknown, path: string): MotionRecipeBindingTarget {
  const raw = plainRecord(value, path)
  const kind = required(raw, 'kind', path)
  if (kind === 'timing') {
    const record = strictRecord(value, path, ['kind', 'trackId', 'field'])
    const field = required(record, 'field', path)
    if (typeof field !== 'string' || !TIMING_FIELDS.has(field as MotionRecipeTimingField)) {
      return invalid(`${path}.field`, 'invalid_value', 'Unknown Motion timing field')
    }
    return {
      kind,
      trackId: safeId(required(record, 'trackId', path), `${path}.trackId`),
      field: field as MotionRecipeTimingField
    }
  }
  if (kind === 'keyframe') {
    const record = strictRecord(value, path, ['kind', 'trackId', 'keyframeIndex', 'field'])
    const field = required(record, 'field', path)
    if (typeof field !== 'string' || !KEYFRAME_FIELDS.has(field as MotionRecipeKeyframeField)) {
      return invalid(`${path}.field`, 'invalid_value', 'Unknown Motion keyframe field')
    }
    return {
      kind,
      trackId: safeId(required(record, 'trackId', path), `${path}.trackId`),
      keyframeIndex: integer(
        required(record, 'keyframeIndex', path),
        `${path}.keyframeIndex`,
        0,
        MOTION_LIMITS.maxKeyframes - 1
      ),
      field: field as MotionRecipeKeyframeField
    }
  }
  return invalid(`${path}.kind`, 'invalid_value', 'Unknown Motion recipe binding target')
}

function targetKey(target: MotionRecipeBindingTarget): string {
  return target.kind === 'timing'
    ? `timing:${target.trackId}:${target.field}`
    : `keyframe:${target.trackId}:${target.keyframeIndex}:${target.field}`
}

function targetLimits(target: MotionRecipeBindingTarget): Readonly<{ min: number; max: number }> {
  if (target.kind === 'keyframe') return MOTION_RECIPE_KEYFRAME_FIELD_LIMITS[target.field]
  return target.field === 'durationMs' ? MOTION_LIMITS.durationMs : MOTION_LIMITS.delayMs
}

function validateBindingTarget(
  motion: MotionSpec,
  target: MotionRecipeBindingTarget,
  path: string
): void {
  const track = motion.tracks.find((candidate) => candidate.id === target.trackId)
  if (!track) return invalid(`${path}.trackId`, 'invalid_value', 'Unknown Motion track id')
  if (target.kind === 'timing') return
  const keyframe = track.keyframes.at(target.keyframeIndex)
  if (!keyframe) {
    return invalid(`${path}.keyframeIndex`, 'out_of_range', 'Unknown Motion keyframe index')
  }
  if (keyframe[target.field] === undefined) {
    return invalid(
      `${path}.field`,
      'invalid_value',
      'Recipe bindings may only replace an authored Motion keyframe field'
    )
  }
}

function parseBinding(
  value: unknown,
  path: string,
  motion: MotionSpec,
  parameters: ReadonlyMap<string, MotionRecipeParameter>
): MotionRecipeBinding {
  const record = strictRecord(value, path, ['parameterId', 'target'])
  const parameterId = safeId(required(record, 'parameterId', path), `${path}.parameterId`)
  const parameter = parameters.get(parameterId)
  if (!parameter) return invalid(`${path}.parameterId`, 'invalid_value', 'Unknown recipe parameter')
  const target = parseBindingTarget(required(record, 'target', path), `${path}.target`)
  validateBindingTarget(motion, target, `${path}.target`)
  const limits = targetLimits(target)
  if (parameter.min < limits.min || parameter.max > limits.max) {
    return invalid(
      `${path}.parameterId`,
      'out_of_range',
      `Parameter range must fit the target range ${limits.min} to ${limits.max}`
    )
  }
  return { parameterId, target }
}

function parseStaggerStep(
  value: unknown,
  path: string,
  parameters: ReadonlyMap<string, MotionRecipeParameter>
): number | MotionRecipeParameterReference {
  if (typeof value === 'number') {
    return boundedNumber(value, path, MOTION_LIMITS.delayMs.min, MOTION_LIMITS.delayMs.max)
  }
  const record = strictRecord(value, path, ['parameterId'])
  const parameterId = safeId(required(record, 'parameterId', path), `${path}.parameterId`)
  const parameter = parameters.get(parameterId)
  if (!parameter) return invalid(`${path}.parameterId`, 'invalid_value', 'Unknown recipe parameter')
  if (parameter.min < MOTION_LIMITS.delayMs.min || parameter.max > MOTION_LIMITS.delayMs.max) {
    return invalid(
      `${path}.parameterId`,
      'out_of_range',
      `Stagger parameters must stay within ${MOTION_LIMITS.delayMs.min} to ${MOTION_LIMITS.delayMs.max}`
    )
  }
  return { parameterId }
}

function parseStagger(
  value: unknown,
  path: string,
  parameters: ReadonlyMap<string, MotionRecipeParameter>
): MotionRecipeStagger {
  const record = strictRecord(value, path, ['stepMs', 'direction', 'rhythm'])
  const stagger: MotionRecipeStagger = {
    stepMs: parseStaggerStep(required(record, 'stepMs', path), `${path}.stepMs`, parameters)
  }
  if (Object.hasOwn(record, 'direction')) {
    if (
      typeof record.direction !== 'string' ||
      !STAGGER_DIRECTIONS.has(record.direction as MotionStaggerDirection)
    ) {
      return invalid(`${path}.direction`, 'invalid_value', 'Unknown stagger direction')
    }
    stagger.direction = record.direction as MotionStaggerDirection
  }
  if (Object.hasOwn(record, 'rhythm')) {
    if (
      typeof record.rhythm !== 'string' ||
      !STAGGER_RHYTHMS.has(record.rhythm as MotionStaggerRhythm)
    ) {
      return invalid(`${path}.rhythm`, 'invalid_value', 'Unknown stagger rhythm')
    }
    stagger.rhythm = record.rhythm as MotionStaggerRhythm
  }
  return stagger
}

function parseRole(
  value: unknown,
  path: string,
  parameters: ReadonlyMap<string, MotionRecipeParameter>,
  usedParameters: Set<string>
): MotionRecipeRole {
  const record = strictRecord(value, path, ['id', 'motion', 'bindings', 'stagger'])
  const motion = parsePortableMotion(required(record, 'motion', path), `${path}.motion`)
  const role: MotionRecipeRole = {
    id: safeId(required(record, 'id', path), `${path}.id`),
    motion
  }
  if (Object.hasOwn(record, 'bindings')) {
    if (!Array.isArray(record.bindings)) {
      return invalid(`${path}.bindings`, 'invalid_type', 'Expected an array')
    }
    if (record.bindings.length > MOTION_RECIPE_LIMITS.maxBindingsPerRole) {
      return invalid(
        `${path}.bindings`,
        'limit_exceeded',
        `A role may contain at most ${MOTION_RECIPE_LIMITS.maxBindingsPerRole} bindings`
      )
    }
    const bindingTargets = new Set<string>()
    role.bindings = record.bindings.map((binding, index) => {
      const bindingPath = `${path}.bindings[${index}]`
      const parsed = parseBinding(binding, bindingPath, motion, parameters)
      const key = targetKey(parsed.target)
      if (bindingTargets.has(key)) {
        return invalid(`${bindingPath}.target`, 'invalid_value', 'Binding targets must be unique')
      }
      bindingTargets.add(key)
      usedParameters.add(parsed.parameterId)
      return parsed
    })
  }
  if (Object.hasOwn(record, 'stagger')) {
    role.stagger = parseStagger(record.stagger, `${path}.stagger`, parameters)
    if (typeof role.stagger.stepMs !== 'number') {
      usedParameters.add(role.stagger.stepMs.parameterId)
    }
  }
  return role
}

function assertUniqueIds(values: readonly { id: string }[], path: string, label: string): void {
  const ids = new Set<string>()
  values.forEach((value, index) => {
    if (ids.has(value.id)) {
      invalid(`${path}[${index}].id`, 'invalid_value', `${label} ids must be unique`)
    }
    ids.add(value.id)
  })
}

/** Strictly parse a detached, portable Motion Recipe v1 snapshot. */
export function parseMotionRecipe(value: unknown): MotionRecipe {
  assertMotionPortableValue(value, 'recipe', { invalid, plainRecord })
  const record = strictRecord(value, 'recipe', [
    'format',
    'version',
    'id',
    'name',
    'description',
    'parameters',
    'roles'
  ])
  if (required(record, 'format', 'recipe') !== MOTION_RECIPE_FORMAT) {
    return invalid('recipe.format', 'invalid_value', 'Unknown Motion recipe format')
  }
  if (required(record, 'version', 'recipe') !== MOTION_RECIPE_VERSION) {
    return invalid('recipe.version', 'invalid_value', 'Unsupported Motion recipe version')
  }
  const rawParameters = required(record, 'parameters', 'recipe')
  if (!Array.isArray(rawParameters)) {
    return invalid('recipe.parameters', 'invalid_type', 'Expected an array')
  }
  if (rawParameters.length > MOTION_RECIPE_LIMITS.maxParameters) {
    return invalid(
      'recipe.parameters',
      'limit_exceeded',
      `A recipe may contain at most ${MOTION_RECIPE_LIMITS.maxParameters} parameters`
    )
  }
  const parameters = rawParameters.map((parameter, index) =>
    parseParameter(parameter, `recipe.parameters[${index}]`)
  )
  assertUniqueIds(parameters, 'recipe.parameters', 'Parameter')
  const parameterMap = new Map(parameters.map((parameter) => [parameter.id, parameter]))

  const rawRoles = required(record, 'roles', 'recipe')
  if (!Array.isArray(rawRoles)) return invalid('recipe.roles', 'invalid_type', 'Expected an array')
  if (rawRoles.length < 1 || rawRoles.length > MOTION_RECIPE_LIMITS.maxRoles) {
    return invalid(
      'recipe.roles',
      'limit_exceeded',
      `Expected between 1 and ${MOTION_RECIPE_LIMITS.maxRoles} roles`
    )
  }
  const usedParameters = new Set<string>()
  const roles = rawRoles.map((role, index) =>
    parseRole(role, `recipe.roles[${index}]`, parameterMap, usedParameters)
  )
  assertUniqueIds(roles, 'recipe.roles', 'Role')
  const totalBindings = roles.reduce((sum, role) => sum + (role.bindings?.length ?? 0), 0)
  if (totalBindings > MOTION_RECIPE_LIMITS.maxTotalBindings) {
    return invalid(
      'recipe.roles',
      'limit_exceeded',
      `A recipe may contain at most ${MOTION_RECIPE_LIMITS.maxTotalBindings} bindings`
    )
  }
  parameters.forEach((parameter, index) => {
    if (!usedParameters.has(parameter.id)) {
      invalid(
        `recipe.parameters[${index}].id`,
        'invalid_value',
        'Every recipe parameter must be referenced by a binding or stagger'
      )
    }
  })

  const recipe: MotionRecipe = {
    format: MOTION_RECIPE_FORMAT,
    version: MOTION_RECIPE_VERSION,
    id: safeId(required(record, 'id', 'recipe'), 'recipe.id'),
    name: text(
      required(record, 'name', 'recipe'),
      'recipe.name',
      1,
      MOTION_RECIPE_LIMITS.maxNameLength
    ),
    parameters,
    roles
  }
  if (Object.hasOwn(record, 'description')) {
    recipe.description = text(
      record.description,
      'recipe.description',
      0,
      MOTION_RECIPE_LIMITS.maxDescriptionLength
    )
  }
  return recipe
}

export function validateMotionRecipe(value: unknown): MotionRecipeValidationResult {
  try {
    return { success: true, value: parseMotionRecipe(value) }
  } catch (error) {
    if (error instanceof MotionRecipeValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}

export function isMotionRecipe(value: unknown): value is MotionRecipe {
  return validateMotionRecipe(value).success
}

/** Return a detached, deeply validated copy of a recipe. */
export function cloneMotionRecipe(recipe: MotionRecipe): MotionRecipe {
  const parsed = parseMotionRecipe(recipe)
  return {
    ...parsed,
    parameters: parsed.parameters.map((parameter) => ({ ...parameter })),
    roles: parsed.roles.map((role) => ({
      ...role,
      motion: cloneMotionSpec(role.motion),
      ...(role.bindings === undefined
        ? {}
        : {
            bindings: role.bindings.map((binding) => ({
              ...binding,
              target: { ...binding.target }
            }))
          }),
      ...(role.stagger === undefined
        ? {}
        : {
            stagger: {
              ...role.stagger,
              stepMs:
                typeof role.stagger.stepMs === 'number'
                  ? role.stagger.stepMs
                  : { ...role.stagger.stepMs }
            }
          })
    }))
  }
}
