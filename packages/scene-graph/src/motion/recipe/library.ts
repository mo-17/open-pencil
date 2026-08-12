import { cloneMotionRecipe, parseMotionRecipe } from '../recipe'
import type { MotionRecipe } from './types'

export const MOTION_RECIPE_LIBRARY_FORMAT = 'openpencil-motion-recipe-library' as const
export const MOTION_RECIPE_LIBRARY_SCHEMA_VERSION = 1 as const

export const MOTION_RECIPE_LIBRARY_LIMITS = Object.freeze({
  maxRecipes: 64,
  maxJsonBytes: 4 * 1024 * 1024
})

export type MotionRecipeMergePolicy = 'error' | 'skip' | 'replace'

export interface MotionRecipeLibrary {
  format: typeof MOTION_RECIPE_LIBRARY_FORMAT
  schemaVersion: typeof MOTION_RECIPE_LIBRARY_SCHEMA_VERSION
  recipes: MotionRecipe[]
}

export class MotionRecipeLibraryValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MotionRecipeLibraryValidationError'
  }
}

interface MotionRecipeLibraryRecord {
  [key: string]: unknown
}

function invalid(message: string): never {
  throw new MotionRecipeLibraryValidationError(message)
}

function strictRecord(value: unknown): MotionRecipeLibraryRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('Motion recipe library must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid('Motion recipe library must not have a custom prototype.')
  }
  const allowed = new Set(['format', 'schemaVersion', 'recipes'])
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      return invalid(`Unknown Motion recipe library field: ${String(key)}`)
    }
  }
  return value as MotionRecipeLibraryRecord
}

function jsonByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertJSONSize(value: string): void {
  if (jsonByteLength(value) > MOTION_RECIPE_LIBRARY_LIMITS.maxJsonBytes) {
    invalid(
      `Motion recipe library may not exceed ${MOTION_RECIPE_LIBRARY_LIMITS.maxJsonBytes} UTF-8 bytes.`
    )
  }
}

/** Parse a complete, detached personal Motion Recipe library snapshot. */
export function parseMotionRecipeLibrary(value: unknown): MotionRecipeLibrary {
  const record = strictRecord(value)
  if (record.format !== MOTION_RECIPE_LIBRARY_FORMAT) {
    return invalid('Unknown Motion recipe library format.')
  }
  if (record.schemaVersion !== MOTION_RECIPE_LIBRARY_SCHEMA_VERSION) {
    return invalid('Unsupported Motion recipe library schema version.')
  }
  if (!Array.isArray(record.recipes)) {
    return invalid('Motion recipe library recipes must be an array.')
  }
  if (record.recipes.length > MOTION_RECIPE_LIBRARY_LIMITS.maxRecipes) {
    return invalid(
      `A Motion recipe library may contain at most ${MOTION_RECIPE_LIBRARY_LIMITS.maxRecipes} recipes.`
    )
  }
  const recipes = record.recipes.map(parseMotionRecipe)
  const ids = new Set<string>()
  for (const recipe of recipes) {
    if (ids.has(recipe.id)) return invalid(`Duplicate Motion recipe id: ${recipe.id}`)
    ids.add(recipe.id)
  }
  const library: MotionRecipeLibrary = {
    format: MOTION_RECIPE_LIBRARY_FORMAT,
    schemaVersion: MOTION_RECIPE_LIBRARY_SCHEMA_VERSION,
    recipes
  }
  assertJSONSize(JSON.stringify(library))
  return library
}

export function parseMotionRecipeLibraryJSON(json: string): MotionRecipeLibrary {
  assertJSONSize(json)
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (cause) {
    throw new MotionRecipeLibraryValidationError('Motion recipe library must be valid JSON.', {
      cause
    })
  }
  return parseMotionRecipeLibrary(value)
}

export function createMotionRecipeLibrary(
  recipes: readonly MotionRecipe[] = []
): MotionRecipeLibrary {
  return parseMotionRecipeLibrary({
    format: MOTION_RECIPE_LIBRARY_FORMAT,
    schemaVersion: MOTION_RECIPE_LIBRARY_SCHEMA_VERSION,
    recipes
  })
}

export function serializeMotionRecipeLibrary(value: MotionRecipeLibrary): string {
  return `${JSON.stringify(parseMotionRecipeLibrary(value), null, 2)}\n`
}

function parseMergePolicy(value: unknown): MotionRecipeMergePolicy {
  switch (value) {
    case 'error':
    case 'skip':
    case 'replace':
      return value
    default:
      return invalid(`Unknown Motion recipe merge policy: ${String(value)}`)
  }
}

export function mergeMotionRecipeLibraries(
  current: MotionRecipeLibrary,
  incoming: MotionRecipeLibrary,
  policy: MotionRecipeMergePolicy = 'error'
): MotionRecipeLibrary {
  const mergePolicy = parseMergePolicy(policy)
  const base = parseMotionRecipeLibrary(current)
  const source = parseMotionRecipeLibrary(incoming)
  const recipes = base.recipes.map(cloneMotionRecipe)
  const indexes = new Map(recipes.map((recipe, index) => [recipe.id, index]))
  for (const recipe of source.recipes) {
    const index = indexes.get(recipe.id)
    if (index === undefined) {
      indexes.set(recipe.id, recipes.length)
      recipes.push(cloneMotionRecipe(recipe))
      continue
    }
    if (mergePolicy === 'error') return invalid(`Motion recipe id conflict: ${recipe.id}`)
    if (mergePolicy === 'replace') recipes[index] = cloneMotionRecipe(recipe)
  }
  return createMotionRecipeLibrary(recipes)
}
