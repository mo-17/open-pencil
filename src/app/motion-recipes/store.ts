import {
  cloneMotionRecipe,
  createMotionRecipeLibrary,
  instantiateMotionRecipe,
  mergeMotionRecipeLibraries,
  parseMotionRecipe,
  parseMotionRecipeLibraryJson,
  serializeMotionRecipeLibrary,
  type MotionRecipe,
  type MotionRecipeInstantiationInput,
  type MotionRecipeLibrary,
  type MotionRecipeMergePolicy
} from '@open-pencil/scene-graph'

import {
  MOTION_RECIPE_LIBRARY_STORAGE_KEY,
  browserMotionRecipeStorage,
  type MotionRecipeKeyValueStorage
} from './storage'

export type MotionRecipeLibraryStoreErrorCode =
  | 'blocked'
  | 'duplicate-name'
  | 'invalid-library'
  | 'read-failed'
  | 'unknown-recipe'
  | 'write-failed'

export class MotionRecipeLibraryStoreError extends Error {
  constructor(
    readonly code: MotionRecipeLibraryStoreErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'MotionRecipeLibraryStoreError'
  }
}

export interface MotionRecipeLibraryStoreSnapshot {
  readonly library: MotionRecipeLibrary
  readonly blocked: boolean
  readonly error: MotionRecipeLibraryStoreError | null
}

export interface CreateMotionRecipeLibraryStoreOptions {
  readonly storage?: MotionRecipeKeyValueStorage | null
}

type StoreListener = (snapshot: MotionRecipeLibraryStoreSnapshot) => void

function storeError(
  code: MotionRecipeLibraryStoreErrorCode,
  message: string,
  cause?: unknown
): MotionRecipeLibraryStoreError {
  return new MotionRecipeLibraryStoreError(
    code,
    message,
    cause === undefined ? undefined : { cause }
  )
}

function asStoreError(cause: unknown): MotionRecipeLibraryStoreError {
  if (cause instanceof MotionRecipeLibraryStoreError) return cause
  return storeError(
    'invalid-library',
    cause instanceof Error ? cause.message : 'The Motion recipe library is invalid.',
    cause
  )
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function assertUniqueNames(library: MotionRecipeLibrary): void {
  const names = new Set<string>()
  for (const recipe of library.recipes) {
    const key = normalizedName(recipe.name)
    if (names.has(key)) {
      throw storeError('duplicate-name', `A Motion recipe named “${recipe.name}” already exists.`)
    }
    names.add(key)
  }
}

function parseLibraryJson(json: string): MotionRecipeLibrary {
  try {
    const library = parseMotionRecipeLibraryJson(json)
    assertUniqueNames(library)
    return library
  } catch (cause) {
    throw asStoreError(cause)
  }
}

export function createMotionRecipeLibraryStore(
  options: CreateMotionRecipeLibraryStoreOptions = {}
) {
  const storage = options.storage === undefined ? browserMotionRecipeStorage() : options.storage
  const listeners = new Set<StoreListener>()
  let library = createMotionRecipeLibrary()
  let blocked = false
  let error: MotionRecipeLibraryStoreError | null = null

  function snapshot(): MotionRecipeLibraryStoreSnapshot {
    return {
      library: createMotionRecipeLibrary(library.recipes),
      blocked,
      error
    }
  }

  function notify(): void {
    const value = snapshot()
    for (const listener of listeners) listener(value)
  }

  function load(): MotionRecipeLibraryStoreSnapshot {
    let stored: string | null
    try {
      stored = storage?.getItem(MOTION_RECIPE_LIBRARY_STORAGE_KEY) ?? null
    } catch (cause) {
      error = storeError('read-failed', 'Unable to read the local Motion recipe library.', cause)
      blocked = true
      notify()
      return snapshot()
    }
    if (stored === null) {
      library = createMotionRecipeLibrary()
      blocked = false
      error = null
      notify()
      return snapshot()
    }
    try {
      library = parseLibraryJson(stored)
      blocked = false
      error = null
    } catch (cause) {
      error = asStoreError(cause)
      blocked = true
    }
    notify()
    return snapshot()
  }

  function assertWritable(): void {
    if (!blocked) return
    throw storeError(
      'blocked',
      'Stored Motion recipe data is preserved because it could not be validated. Import a valid complete library snapshot to recover.'
    )
  }

  function commit(
    next: MotionRecipeLibrary,
    options: { allowBlockedRecovery?: boolean } = {}
  ): MotionRecipeLibraryStoreSnapshot {
    if (!options.allowBlockedRecovery) assertWritable()
    const parsed = createMotionRecipeLibrary(next.recipes)
    assertUniqueNames(parsed)
    const json = serializeMotionRecipeLibrary(parsed)
    try {
      storage?.setItem(MOTION_RECIPE_LIBRARY_STORAGE_KEY, json)
    } catch (cause) {
      const failure = storeError(
        'write-failed',
        'Unable to save the local Motion recipe library.',
        cause
      )
      error = failure
      notify()
      throw failure
    }
    library = parsed
    blocked = false
    error = null
    notify()
    return snapshot()
  }

  function requireRecipe(id: string): MotionRecipe {
    const recipe = library.recipes.find((candidate) => candidate.id === id)
    if (!recipe) throw storeError('unknown-recipe', `Unknown Motion recipe: ${id}`)
    return recipe
  }

  function addRecipe(value: unknown): MotionRecipe {
    assertWritable()
    const recipe = parseMotionRecipe(value)
    if (library.recipes.some((candidate) => candidate.id === recipe.id)) {
      throw storeError('invalid-library', `Motion recipe id already exists: ${recipe.id}`)
    }
    if (
      library.recipes.some(
        (candidate) => normalizedName(candidate.name) === normalizedName(recipe.name)
      )
    ) {
      throw storeError('duplicate-name', `A Motion recipe named “${recipe.name}” already exists.`)
    }
    commit(createMotionRecipeLibrary([...library.recipes, recipe]))
    return cloneMotionRecipe(recipe)
  }

  function updateRecipe(id: string, value: unknown): MotionRecipe {
    assertWritable()
    requireRecipe(id)
    const recipe = parseMotionRecipe(value)
    if (recipe.id !== id) {
      throw storeError('invalid-library', 'A Motion recipe id cannot change during an update.')
    }
    const next = createMotionRecipeLibrary(
      library.recipes.map((candidate) => (candidate.id === id ? recipe : candidate))
    )
    commit(next)
    return cloneMotionRecipe(recipe)
  }

  function deleteRecipe(id: string): MotionRecipeLibraryStoreSnapshot {
    assertWritable()
    requireRecipe(id)
    return commit(
      createMotionRecipeLibrary(library.recipes.filter((candidate) => candidate.id !== id))
    )
  }

  function importJson(
    json: string,
    policy: MotionRecipeMergePolicy = 'error'
  ): MotionRecipeLibraryStoreSnapshot {
    const incoming = parseLibraryJson(json)
    const base = blocked ? createMotionRecipeLibrary() : library
    let merged: MotionRecipeLibrary
    try {
      merged = mergeMotionRecipeLibraries(base, incoming, policy)
      assertUniqueNames(merged)
    } catch (cause) {
      const failure = asStoreError(cause)
      error = failure
      notify()
      throw failure
    }
    return commit(merged, { allowBlockedRecovery: blocked })
  }

  function exportJson(): string {
    assertWritable()
    return serializeMotionRecipeLibrary(library)
  }

  function subscribe(listener: StoreListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  load()

  return {
    snapshot,
    subscribe,
    reload: load,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    importJson,
    exportJson,
    instantiate: (id: string, input: MotionRecipeInstantiationInput) =>
      instantiateMotionRecipe(requireRecipe(id), input)
  }
}
