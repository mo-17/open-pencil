import { randomUUID } from 'node:crypto'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

import { defineCommand } from 'citty'

import {
  instantiateMotionRecipe,
  parseMotionRecipe,
  type MotionRecipe,
  type MotionRecipeInstantiationInput,
  type SceneGraph
} from '@open-pencil/scene-graph'

import { bold, fmtList, ok } from '#cli/format'
import { loadDocument, populateWholeDocument, saveDocument } from '#cli/headless'

import {
  assertMotionTargetsCompatible,
  motionNodeChanges as motionChanges,
  printMotionJSON as printJSON,
  runMotionCommandSafely as runSafely
} from './common'

const MAX_RECIPE_JSON_BYTES = 1024 * 1024
const jsonArg = { type: 'boolean', default: false, description: 'Output JSON' } as const
const outputJSONArg = {
  type: 'string',
  alias: 'o',
  description: 'Optional output JSON path'
} as const
const rolesArg = {
  type: 'string',
  required: true,
  description: 'JSON object mapping every role id to node id arrays'
} as const
const parametersArg = {
  type: 'string',
  description: 'JSON object of bounded parameter overrides'
} as const

interface MotionRecipeArgumentRecord {
  [key: string]: unknown
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

async function readRecipe(path: string): Promise<MotionRecipe> {
  const absolute = resolve(path)
  const info = await stat(absolute)
  if (info.size > MAX_RECIPE_JSON_BYTES) {
    throw new Error(`Motion recipe may not exceed ${MAX_RECIPE_JSON_BYTES} bytes.`)
  }
  const json = await Bun.file(absolute).text()
  return parseMotionRecipe(JSON.parse(json) as unknown)
}

function parseObjectArg(value: string, label: string): MotionRecipeArgumentRecord {
  if (byteLength(value) > MAX_RECIPE_JSON_BYTES) {
    throw new Error(`${label} may not exceed ${MAX_RECIPE_JSON_BYTES} UTF-8 bytes.`)
  }
  const parsed: unknown = JSON.parse(value)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must encode a JSON object.`)
  }
  return parsed as MotionRecipeArgumentRecord
}

function instantiationInput(roles: string, parameters?: string): MotionRecipeInstantiationInput {
  return {
    roleMapping: parseObjectArg(roles, 'roles') as Record<string, readonly string[]>,
    ...(parameters
      ? { parameters: parseObjectArg(parameters, 'parameters') as Record<string, number> }
      : {})
  }
}

async function atomicWrite(path: string, data: string | Uint8Array): Promise<string> {
  const output = resolve(path)
  const temporary = resolve(dirname(output), `.${randomUUID()}.openpencil-tmp`)
  try {
    await writeFile(temporary, data, { flag: 'wx' })
    await rename(temporary, output)
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw cause
  }
  return output
}

async function atomicWriteJSON(path: string, value: unknown): Promise<string> {
  return atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

function documentFormat(path: string): string {
  const format = extname(path).slice(1).toLowerCase()
  if (format !== 'fig' && format !== 'pen') {
    throw new Error('Motion recipe apply output must use the .fig or .pen extension.')
  }
  return format
}

async function atomicWriteDocument(path: string, graph: SceneGraph): Promise<string> {
  const output = resolve(path)
  const temporary = resolve(dirname(output), `.${randomUUID()}.openpencil-tmp`)
  try {
    await saveDocument(documentFormat(output), graph, temporary)
    await rename(temporary, output)
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw cause
  }
  return output
}

function printRecipe(recipe: MotionRecipe): void {
  console.log('')
  console.log(bold(`  ${recipe.name}`))
  console.log('')
  console.log(
    fmtList([
      {
        header: recipe.id,
        details: {
          version: recipe.version,
          roles: recipe.roles.length,
          parameters: recipe.parameters.length,
          tracks: recipe.roles.reduce((sum, role) => sum + role.motion.tracks.length, 0)
        }
      }
    ])
  )
  console.log('')
}

const validate = defineCommand({
  meta: { description: 'Strictly validate a bounded Motion Recipe v1 snapshot' },
  args: {
    recipe: { type: 'positional', required: true, description: 'Motion recipe JSON path' },
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const recipe = await readRecipe(args.recipe)
      if (args.json) printJSON({ valid: true, recipe })
      else printRecipe(recipe)
    })
  }
})

const instantiate = defineCommand({
  meta: { description: 'Instantiate explicit Motion Recipe roles and parameter values' },
  args: {
    recipe: { type: 'positional', required: true, description: 'Motion recipe JSON path' },
    roles: rolesArg,
    parameters: parametersArg,
    output: outputJSONArg,
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const result = instantiateMotionRecipe(
        await readRecipe(args.recipe),
        instantiationInput(args.roles, args.parameters)
      )
      const output = args.output ? await atomicWriteJSON(args.output, result) : null
      if (args.json || output === null) printJSON({ result, output })
      else console.log(ok(`Instantiated ${result.recipeId} to ${output}`))
    })
  }
})

const apply = defineCommand({
  meta: { description: 'Atomically apply a Motion Recipe to a .fig or .pen document' },
  args: {
    file: { type: 'positional', required: true, description: 'Input .fig or .pen document' },
    recipe: { type: 'string', required: true, description: 'Motion recipe JSON path' },
    roles: rolesArg,
    parameters: parametersArg,
    output: {
      type: 'string',
      alias: 'o',
      required: true,
      description: 'Atomic output .fig or source-preserving .pen path'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const recipe = await readRecipe(args.recipe)
      const instance = instantiateMotionRecipe(
        recipe,
        instantiationInput(args.roles, args.parameters)
      )
      const graph = await loadDocument(resolve(args.file))
      populateWholeDocument(graph)
      const targets = instance.assignments.map((assignment) => ({
        assignment,
        node: graph.getNode(assignment.nodeId)
      }))
      const missing = targets.filter(({ node }) => node === undefined)
      if (missing.length > 0) {
        throw new Error(
          `Motion recipe target node(s) not found: ${missing
            .map(({ assignment }) => assignment.nodeId)
            .join(', ')}`
        )
      }
      assertMotionTargetsCompatible(
        targets.map(({ assignment, node }) => ({ node, motion: assignment.motion }))
      )
      for (const { assignment, node } of targets) {
        if (node) graph.updateNode(node.id, motionChanges(node, assignment.motion))
      }
      const output = await atomicWriteDocument(args.output, graph)
      const report = {
        recipeId: recipe.id,
        assignmentCount: instance.assignments.length,
        nodeIds: instance.assignments.map(({ nodeId }) => nodeId),
        output
      }
      if (args.json) printJSON(report)
      else
        console.log(ok(`Applied ${recipe.name} to ${report.assignmentCount} node(s) → ${output}`))
    })
  }
})

export default defineCommand({
  meta: { description: 'Validate, instantiate, and apply personal Motion Recipes' },
  subCommands: { validate, instantiate, apply }
})
