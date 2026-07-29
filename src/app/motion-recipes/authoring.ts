import { inspectMotionNodeCapabilities } from '@open-pencil/core/motion'
import {
  cloneMotionSpec,
  instantiateMotionRecipe,
  MOTION_RECIPE_FORMAT,
  parseMotionRecipe,
  type MotionRecipe,
  type MotionRecipeInstantiation,
  type MotionRecipeInstantiationInput,
  type MotionSpec,
  type SceneNode
} from '@open-pencil/scene-graph'

export interface MotionRecipeAuthoringNode {
  readonly id: string
  readonly name: string
  readonly motion?: MotionSpec
}

export interface CreateMotionRecipeFromNodesInput {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly nodes: readonly MotionRecipeAuthoringNode[]
}

export interface MotionRecipeMappingCompatibility {
  readonly compatible: boolean
  readonly assignmentCount: number
  readonly error: string | null
  readonly instance: MotionRecipeInstantiation | null
}

function safeRoleBase(name: string, index: number): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const leadingSafe = /^[A-Za-z]/.test(ascii) ? ascii : `role-${ascii || index + 1}`
  return leadingSafe.slice(0, 56)
}

function uniqueRoleId(name: string, index: number, used: Set<string>): string {
  const base = safeRoleBase(name, index)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    const marker = `-${suffix}`
    candidate = `${base.slice(0, 64 - marker.length)}${marker}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

/** Capture each selected node as an independent role with a complete detached MotionSpec. */
export function createMotionRecipeFromNodes(input: CreateMotionRecipeFromNodesInput): MotionRecipe {
  if (input.nodes.length === 0) throw new Error('Select at least one animated node.')
  const missing = input.nodes.filter((node) => node.motion === undefined)
  if (missing.length > 0) {
    throw new Error(
      `Every recipe role needs Motion data: ${missing.map((node) => node.name).join(', ')}`
    )
  }
  const used = new Set<string>()
  return parseMotionRecipe({
    format: MOTION_RECIPE_FORMAT,
    version: 1,
    id: input.id,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    parameters: [],
    roles: input.nodes.map((node, index) => {
      const motion = cloneMotionSpec(node.motion as MotionSpec)
      delete motion.preset
      return { id: uniqueRoleId(node.name, index, used), motion }
    })
  })
}

/** Suggest a deterministic mapping, while leaving incompatible cardinalities explicit. */
export function defaultMotionRecipeRoleMapping(
  recipe: MotionRecipe,
  selectedNodeIds: readonly string[]
): Record<string, string[]> {
  const ids = [...new Set(selectedNodeIds)]
  if (recipe.roles.length === 1 && ids.length > 0) {
    return { [recipe.roles[0].id]: ids }
  }
  return Object.fromEntries(
    recipe.roles.map((role, index) => [role.id, index < ids.length ? [ids[index]] : []])
  )
}

/** Validate both recipe expansion and exact coverage of the current selection before preview/apply. */
export function checkMotionRecipeMapping(
  recipe: MotionRecipe,
  input: MotionRecipeInstantiationInput,
  selectedNodeIds: readonly string[],
  resolveNode: (nodeId: string) => SceneNode | undefined
): MotionRecipeMappingCompatibility {
  try {
    const selected = [...new Set(selectedNodeIds)]
    if (selected.length === 0) throw new Error('Select at least one target node.')
    const instance = instantiateMotionRecipe(recipe, input)
    const assigned = instance.assignments.map(({ nodeId }) => nodeId)
    if (
      assigned.length !== selected.length ||
      assigned.some((nodeId) => !selected.includes(nodeId))
    ) {
      throw new Error('Role mapping must cover every selected node exactly once.')
    }
    for (const assignment of instance.assignments) {
      const node = resolveNode(assignment.nodeId)
      if (!node) throw new Error(`Motion recipe target node no longer exists: ${assignment.nodeId}`)
      const issues = inspectMotionNodeCapabilities(node, assignment.motion)
      if (issues.length > 0) {
        throw new Error(
          `MotionSpec is incompatible with node ${node.id}: ${issues
            .map(({ path, message }) => `${path}: ${message}`)
            .join('; ')}`
        )
      }
    }
    return {
      compatible: true,
      assignmentCount: instance.assignments.length,
      error: null,
      instance
    }
  } catch (cause) {
    return {
      compatible: false,
      assignmentCount: 0,
      error: cause instanceof Error ? cause.message : String(cause),
      instance: null
    }
  }
}
