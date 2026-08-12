import { describe, expect, test } from 'bun:test'

import {
  MOTION_RECIPE_FORMAT,
  createMotionPreset,
  instantiateMotionRecipe,
  type MotionRecipe,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  MOTION_RECIPE_LIBRARY_FILE_NAME,
  MOTION_RECIPE_LIBRARY_STORAGE_KEY,
  applyMotionRecipeInstantiation,
  checkMotionRecipeMapping,
  createMotionRecipeFromNodes,
  createMotionRecipeLibraryStore,
  defaultMotionRecipeRoleMapping,
  readBrowserMotionRecipeLibraryFile,
  type MotionRecipeKeyValueStorage
} from '@/app/motion-recipes'
import type { MotionMutationEditor } from '@/app/properties/motion'

class MemoryStorage implements MotionRecipeKeyValueStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function parameterizedRecipe(): MotionRecipe {
  const heroMotion = createMotionPreset('fade-in')
  const itemMotion = createMotionPreset('slide-up')
  delete heroMotion.preset
  delete itemMotion.preset
  return {
    format: MOTION_RECIPE_FORMAT,
    version: 1,
    id: 'cardEntrance',
    name: '卡片入场',
    parameters: [{ id: 'duration', defaultValue: 300, min: 100, max: 1_000 }],
    roles: [
      {
        id: 'hero',
        motion: heroMotion,
        bindings: [
          {
            parameterId: 'duration',
            target: { kind: 'timing', trackId: 'fade-in', field: 'durationMs' }
          }
        ]
      },
      { id: 'item', motion: itemMotion }
    ]
  }
}

describe('app personal Motion recipe authoring', () => {
  test('persists a separate complete library and recovers from an invalid future snapshot', () => {
    const storage = new MemoryStorage()
    const store = createMotionRecipeLibraryStore({ storage })
    store.addRecipe(parameterizedRecipe())

    const serialized = storage.getItem(MOTION_RECIPE_LIBRARY_STORAGE_KEY)
    expect(serialized).not.toBeNull()
    if (!serialized) throw new Error('Expected a persisted Motion recipe library')
    const stored = JSON.parse(serialized) as {
      format: string
      schemaVersion: number
      recipes: MotionRecipe[]
    }
    expect(stored.format).toBe('openpencil-motion-recipe-library')
    expect(stored.schemaVersion).toBe(1)
    expect(stored.recipes.map(({ id }) => id)).toEqual(['cardEntrance'])
    expect(stored.recipes[0]?.roles[0]?.motion.tracks).toHaveLength(1)
    expect(createMotionRecipeLibraryStore({ storage }).snapshot().library.recipes).toHaveLength(1)

    storage.setItem(
      MOTION_RECIPE_LIBRARY_STORAGE_KEY,
      JSON.stringify({ format: 'openpencil-motion-recipe-library', schemaVersion: 2, recipes: [] })
    )
    const blocked = createMotionRecipeLibraryStore({ storage })
    expect(blocked.snapshot().blocked).toBe(true)
    expect(() => blocked.addRecipe(parameterizedRecipe())).toThrow(/preserved/)

    const empty = createMotionRecipeLibraryStore({ storage: null }).exportJSON()
    blocked.importJSON(empty)
    expect(blocked.snapshot()).toMatchObject({ blocked: false, error: null })
  })

  test('captures every selected MotionSpec as a detached role and strips preset provenance', () => {
    const preset = createMotionPreset('slide-up')
    const recipe = createMotionRecipeFromNodes({
      id: 'selectionRecipe',
      name: '多选配方',
      nodes: [
        { id: '0:1', name: 'Hero card', motion: preset },
        { id: '0:2', name: 'Hero card', motion: { ...preset, version: 3 } }
      ]
    })

    expect(recipe.roles.map(({ id }) => id)).toEqual(['Hero-card', 'Hero-card-2'])
    expect(recipe.roles.map(({ motion }) => motion.version)).toEqual([1, 3])
    expect(recipe.roles.every(({ motion }) => motion.preset === undefined)).toBe(true)
    expect(recipe.roles[0]?.motion).not.toBe(preset)
  })

  test('reports explicit role compatibility and applies all assignments in one undo batch', () => {
    const recipe = parameterizedRecipe()
    const mapping = defaultMotionRecipeRoleMapping(recipe, ['0:1', '0:2'])
    const compatible = checkMotionRecipeMapping(
      recipe,
      { roleMapping: mapping, parameters: { duration: 640 } },
      ['0:1', '0:2'],
      (id) => ({ id, type: 'RECTANGLE', overrides: {} }) as SceneNode
    )
    expect(compatible).toMatchObject({ compatible: true, assignmentCount: 2, error: null })
    expect(
      checkMotionRecipeMapping(
        recipe,
        { roleMapping: mapping },
        ['0:1', '0:2', '0:3'],
        (id) => ({ id, type: 'RECTANGLE', overrides: {} }) as SceneNode
      )
    ).toMatchObject({ compatible: false, assignmentCount: 0 })

    const nodes = new Map<string, SceneNode>([
      ['0:1', { id: '0:1', type: 'RECTANGLE', overrides: {} } as SceneNode],
      ['0:2', { id: '0:2', type: 'RECTANGLE', overrides: {} } as SceneNode]
    ])
    let batches = 0
    const updates: string[] = []
    const editor = {
      graph: {
        getNode: (id: string) => nodes.get(id),
        getAbsolutePosition: () => ({ x: 0, y: 0 })
      },
      undo: {
        runBatch: <T>(_label: string, apply: () => T) => {
          batches += 1
          return apply()
        }
      },
      updateNodeWithUndo: (id: string, changes: Partial<SceneNode>) => {
        updates.push(id)
        const node = nodes.get(id)
        if (!node) throw new Error(`Missing test node: ${id}`)
        Object.assign(node, changes)
      }
    } satisfies MotionMutationEditor
    const instance = instantiateMotionRecipe(recipe, {
      roleMapping: mapping,
      parameters: { duration: 640 }
    })

    expect(applyMotionRecipeInstantiation(editor, instance, 'Apply recipe')).toBe(2)
    expect(batches).toBe(1)
    expect(updates).toEqual(['0:1', '0:2'])
    expect(nodes.get('0:1')?.motion?.tracks[0]?.timing.durationMs).toBe(640)
  })

  test('rejects incompatible advanced recipe channels before opening an undo batch', () => {
    const node = { id: '0:1', type: 'RECTANGLE', overrides: {} } as SceneNode
    let batches = 0
    const editor = {
      graph: {
        getNode: (id: string) => (id === node.id ? node : undefined),
        getAbsolutePosition: () => ({ x: 0, y: 0 })
      },
      undo: {
        runBatch: <T>(_label: string, apply: () => T) => {
          batches += 1
          return apply()
        }
      },
      updateNodeWithUndo: () => {
        throw new Error('Incompatible recipe must not mutate a node')
      }
    } satisfies MotionMutationEditor
    const instance = instantiateMotionRecipe(
      {
        format: MOTION_RECIPE_FORMAT,
        version: 1,
        id: 'textRecipe',
        name: 'Text reveal',
        parameters: [],
        roles: [
          {
            id: 'copy',
            motion: {
              version: 3,
              tracks: [
                {
                  id: 'reveal',
                  trigger: 'mount',
                  keyframes: [
                    { offset: 0, textReveal: 0 },
                    { offset: 1, textReveal: 1 }
                  ],
                  timing: { durationMs: 300 }
                }
              ]
            }
          }
        ]
      },
      { roleMapping: { copy: [node.id] } }
    )

    expect(
      checkMotionRecipeMapping(
        {
          format: MOTION_RECIPE_FORMAT,
          version: 1,
          id: 'textRecipe',
          name: 'Text reveal',
          parameters: [],
          roles: [{ id: 'copy', motion: instance.assignments[0].motion }]
        },
        { roleMapping: { copy: [node.id] } },
        [node.id],
        (id) => (id === node.id ? node : undefined)
      )
    ).toMatchObject({ compatible: false, assignmentCount: 0, instance: null })

    expect(() => applyMotionRecipeInstantiation(editor, instance, 'Apply recipe')).toThrow(
      /Text reveal requires a TEXT node/
    )
    expect(batches).toBe(0)
    expect(node.motion).toBeUndefined()
  })

  test('bounds browser file imports and uses a stable export file name', async () => {
    expect(MOTION_RECIPE_LIBRARY_FILE_NAME).toBe('openpencil-motion-recipes.json')
    expect(
      await readBrowserMotionRecipeLibraryFile(
        new File(['{"ok":true}'], 'motion-recipes.json', { type: 'application/json' })
      )
    ).toBe('{"ok":true}')
  })
})
