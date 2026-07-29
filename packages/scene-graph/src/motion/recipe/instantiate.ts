import { createMotionContractValidationHelpers } from '../contract-validation'
import { MotionRecipeValidationError, parseMotionRecipe } from '../recipe'
import { assertMotionStaggerBatch, withMotionStagger, type MotionStaggerOptions } from '../stagger'
import type { MotionSpec } from '../types'
import { cloneMotionSpec, MotionValidationError, parseMotionSpec } from '../validation'
import { assertMotionPortableValue, remapMotionIssuePaths } from '../validation-helpers'
import {
  MOTION_RECIPE_LIMITS,
  type MotionRecipe,
  type MotionRecipeAssignment,
  type MotionRecipeInstantiation,
  type MotionRecipeInstantiationInput,
  type MotionRecipeRole,
  type MotionRecipeStagger
} from './types'

const {
  boundedNumber,
  invalid,
  plainRecord,
  required,
  safeNodeReference: nodeReference,
  strictRecord
} = createMotionContractValidationHelpers((issues) => new MotionRecipeValidationError(issues))

function parseInstantiationParameters(
  value: unknown,
  recipe: MotionRecipe
): Record<string, number> {
  const record = value === undefined ? {} : plainRecord(value, 'instance.parameters')
  const known = new Set(recipe.parameters.map((parameter) => parameter.id))
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      invalid(`instance.parameters.${key}`, 'unknown_key', 'Unknown recipe parameter')
    }
  }
  return Object.fromEntries(
    recipe.parameters.map((parameter) => [
      parameter.id,
      Object.hasOwn(record, parameter.id)
        ? boundedNumber(
            record[parameter.id],
            `instance.parameters.${parameter.id}`,
            parameter.min,
            parameter.max
          )
        : parameter.defaultValue
    ])
  )
}

function parseRoleMapping(value: unknown, recipe: MotionRecipe): Map<string, string[]> {
  const record = plainRecord(value, 'instance.roleMapping')
  const roleIds = new Set(recipe.roles.map((role) => role.id))
  for (const key of Object.keys(record)) {
    if (!roleIds.has(key)) {
      invalid(`instance.roleMapping.${key}`, 'unknown_key', 'Unknown recipe role')
    }
  }
  const seenNodes = new Set<string>()
  let assignmentCount = 0
  const mapping = new Map<string, string[]>()
  for (const role of recipe.roles) {
    if (!Object.hasOwn(record, role.id)) {
      invalid(`instance.roleMapping.${role.id}`, 'invalid_value', 'Recipe role mapping is required')
    }
    const rawTargets = record[role.id]
    if (!Array.isArray(rawTargets)) {
      return invalid(`instance.roleMapping.${role.id}`, 'invalid_type', 'Expected an array')
    }
    if (rawTargets.length < 1) {
      invalid(`instance.roleMapping.${role.id}`, 'invalid_value', 'A recipe role needs a target')
    }
    assignmentCount += rawTargets.length
    if (assignmentCount > MOTION_RECIPE_LIMITS.maxAssignments) {
      invalid(
        'instance.roleMapping',
        'limit_exceeded',
        `A recipe may instantiate at most ${MOTION_RECIPE_LIMITS.maxAssignments} assignments`
      )
    }
    const targets = rawTargets.map((target, index) => {
      const nodeId = nodeReference(target, `instance.roleMapping.${role.id}[${index}]`)
      if (seenNodes.has(nodeId)) {
        invalid(
          `instance.roleMapping.${role.id}[${index}]`,
          'invalid_value',
          'A node may only be mapped to one recipe role'
        )
      }
      seenNodes.add(nodeId)
      return nodeId
    })
    mapping.set(role.id, targets)
  }
  return mapping
}

function remapMotionError(error: unknown, path: string): never {
  if (!(error instanceof MotionValidationError)) throw error
  throw new MotionRecipeValidationError(remapMotionIssuePaths(error.issues, path))
}

function parameterValue(
  parameters: Readonly<Record<string, number>>,
  parameterId: string,
  path: string,
  message: string
): number {
  if (!Object.hasOwn(parameters, parameterId)) return invalid(path, 'invalid_value', message)
  return parameters[parameterId]
}

function applyBindings(
  role: MotionRecipeRole,
  parameters: Readonly<Record<string, number>>,
  path: string
): MotionSpec {
  const motion = cloneMotionSpec(role.motion)
  for (const binding of role.bindings ?? []) {
    const track = motion.tracks.find((candidate) => candidate.id === binding.target.trackId)
    if (!track) return invalid(path, 'invalid_value', 'Recipe binding references an unknown track')
    const value = parameterValue(
      parameters,
      binding.parameterId,
      path,
      'Recipe binding references an unknown parameter'
    )
    if (binding.target.kind === 'timing') {
      if (binding.target.field === 'durationMs') track.timing.durationMs = value
      else track.timing.delayMs = value
      continue
    }
    const keyframe = track.keyframes.at(binding.target.keyframeIndex)
    if (!keyframe) return invalid(path, 'invalid_value', 'Recipe binding references a keyframe')
    keyframe[binding.target.field] = value
  }
  try {
    return parseMotionSpec(motion)
  } catch (error) {
    return remapMotionError(error, path)
  }
}

function staggerOptions(
  stagger: MotionRecipeStagger,
  parameters: Readonly<Record<string, number>>
): MotionStaggerOptions {
  const stepMs =
    typeof stagger.stepMs === 'number'
      ? stagger.stepMs
      : parameterValue(
          parameters,
          stagger.stepMs.parameterId,
          'instance.parameters',
          'Unknown stagger parameter'
        )
  return {
    stepMs,
    ...(stagger.direction === undefined ? {} : { direction: stagger.direction }),
    ...(stagger.rhythm === undefined ? {} : { rhythm: stagger.rhythm })
  }
}

function remapStaggerError(error: unknown, path: string): never {
  if (!(error instanceof MotionValidationError)) throw error
  throw new MotionRecipeValidationError(
    error.issues.map((issue) => ({ ...issue, path: `${path}.${issue.path}` }))
  )
}

/**
 * Expand explicit role mappings into detached node-local MotionSpec snapshots.
 * Recipe role order and each role's target-array order define deterministic output and stagger order.
 */
export function instantiateMotionRecipe(
  value: unknown,
  input: MotionRecipeInstantiationInput
): MotionRecipeInstantiation {
  const recipe = parseMotionRecipe(value)
  assertMotionPortableValue(input, 'instance', { invalid, plainRecord })
  const record = strictRecord(input, 'instance', ['roleMapping', 'parameters'])
  const parameters = parseInstantiationParameters(record.parameters, recipe)
  const roleMapping = parseRoleMapping(required(record, 'roleMapping', 'instance'), recipe)
  const assignments: MotionRecipeAssignment[] = []

  for (const role of recipe.roles) {
    const targets = roleMapping.get(role.id)
    if (!targets) return invalid('instance.roleMapping', 'invalid_value', 'Missing recipe role')
    const base = applyBindings(role, parameters, `instance.roles.${role.id}.motion`)
    const stagger = role.stagger ? staggerOptions(role.stagger, parameters) : undefined
    if (stagger) {
      try {
        assertMotionStaggerBatch(base, targets.length, stagger)
      } catch (error) {
        remapStaggerError(error, `instance.roles.${role.id}.stagger`)
      }
    }
    for (const [index, nodeId] of targets.entries()) {
      let motion: MotionSpec
      try {
        motion = stagger
          ? withMotionStagger(base, index, targets.length, stagger)
          : cloneMotionSpec(base)
      } catch (error) {
        remapStaggerError(error, `instance.roles.${role.id}.stagger`)
      }
      assignments.push({ roleId: role.id, nodeId, motion })
    }
  }

  return {
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    parameters,
    assignments
  }
}
