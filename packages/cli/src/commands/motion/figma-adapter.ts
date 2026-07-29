import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { defineCommand } from 'citty'

import {
  buildFigmaMotionPluginScript,
  createFigmaNativeMotionPlan,
  FIGMA_NATIVE_MOTION_OWNERSHIP_KEY,
  FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
  type FigmaNativeMotionConflictPolicy,
  type FigmaNativeMotionPlan
} from '@open-pencil/fig'
import type { SceneNode } from '@open-pencil/scene-graph'

import { dim, fail, fmtList, fmtNode, ok, printError } from '#cli/format'
import { loadDocument, populateWholeDocument } from '#cli/headless'

const CONFLICT_POLICIES = new Set<FigmaNativeMotionConflictPolicy>(['replace-owned', 'replace-all'])

interface AdapterResult {
  version: 1
  source: {
    file: string
    node: Pick<SceneNode, 'id' | 'name' | 'type'>
  }
  target: { mode: 'selection' } | { mode: 'node-id'; nodeId: string }
  safety: {
    conflictPolicy: FigmaNativeMotionConflictPolicy
    allowTimelineGrowth: boolean
    durationPolicy: FigmaNativeMotionPlan['durationPolicy']
    ownership: string
  }
  plan: FigmaNativeMotionPlan
  script: string | null
  output: string | null
}

function conflictPolicy(value: string): FigmaNativeMotionConflictPolicy {
  if (CONFLICT_POLICIES.has(value as FigmaNativeMotionConflictPolicy)) {
    return value as FigmaNativeMotionConflictPolicy
  }
  throw new Error(`Unknown conflict policy "${value}". Expected replace-owned or replace-all.`)
}

function printHumanResult(result: AdapterResult): void {
  const { node } = result.source
  const target =
    result.target.mode === 'selection'
      ? 'current Figma selection'
      : `Figma node ${result.target.nodeId}`
  const managedFields = result.plan.managedFields.map((field) => field.name).join(', ')

  console.log('')
  console.log(
    fmtNode(
      { type: node.type, name: node.name, id: node.id },
      {
        native: result.plan.supported ? ok('supported') : fail('unsupported'),
        target,
        duration:
          result.plan.durationSeconds === undefined ? undefined : `${result.plan.durationSeconds}s`,
        fields: managedFields || undefined,
        conflicts: result.safety.conflictPolicy,
        timeline: result.safety.allowTimelineGrowth ? 'growth allowed' : 'grow only with consent'
      }
    )
  )

  const diagnostics = [
    ...result.plan.issues.map((issue) => ({
      header: fail(issue.code),
      details: { message: issue.message }
    })),
    ...result.plan.warnings.map((warning) => ({
      header: dim(warning.code),
      details: { message: warning.message }
    }))
  ]
  if (diagnostics.length > 0) {
    console.log('')
    console.log(fmtList(diagnostics, { numbered: false }))
  }

  console.log('')
  if (result.output) {
    console.log(ok(`Wrote ${result.output}`))
  } else if (result.script) {
    console.log(dim('Script generated; use -o <file> to write it or --json to read it.'))
  }
  console.log('')
}

export default defineCommand({
  meta: {
    description: 'Generate a safe Figma Plugin API Motion adapter script for one OpenPencil node'
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Source design document (.fig, .pen)'
    },
    node: {
      type: 'string',
      required: true,
      description: 'Source OpenPencil node ID containing MotionSpec data'
    },
    'target-node': {
      type: 'string',
      description:
        'Target Figma node ID; omit to require exactly one selected node when the script runs'
    },
    'conflict-policy': {
      type: 'string',
      default: 'replace-owned',
      description: 'Conflict policy: replace-owned (safe default) or replace-all (destructive)'
    },
    'allow-timeline-growth': {
      type: 'boolean',
      default: false,
      description: 'Allow extending an existing shared Figma timeline'
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Write the generated Figma plugin script to this path'
    },
    json: { type: 'boolean', default: false, description: 'Output the adapter report as JSON' }
  },
  async run({ args }) {
    let policy: FigmaNativeMotionConflictPolicy
    try {
      policy = conflictPolicy(args['conflict-policy'])
    } catch (error) {
      printError(error)
      process.exitCode = 1
      return
    }

    const sourceFile = resolve(args.file)
    const graph = await loadDocument(sourceFile)
    populateWholeDocument(graph)
    const node = graph.getNode(args.node)
    if (!node) {
      printError(`Node "${args.node}" not found`)
      process.exitCode = 1
      return
    }

    const plan = createFigmaNativeMotionPlan(node.motion, { nodeOpacity: node.opacity })
    const script = plan.supported
      ? buildFigmaMotionPluginScript(plan, {
          nodeId: args['target-node'],
          conflictPolicy: policy,
          allowTimelineGrowth: args['allow-timeline-growth']
        })
      : null
    const output = script && args.output ? resolve(args.output) : null
    if (script && output) await writeFile(output, script, 'utf8')

    const result: AdapterResult = {
      version: 1,
      source: {
        file: sourceFile,
        node: { id: node.id, name: node.name, type: node.type }
      },
      target: args['target-node']
        ? { mode: 'node-id', nodeId: args['target-node'] }
        : { mode: 'selection' },
      safety: {
        conflictPolicy: policy,
        allowTimelineGrowth: args['allow-timeline-growth'],
        durationPolicy: plan.durationPolicy,
        ownership: `${FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE}/${FIGMA_NATIVE_MOTION_OWNERSHIP_KEY}`
      },
      plan,
      script,
      output
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (script && output === null) {
      process.stdout.write(`${script}\n`)
    } else {
      printHumanResult(result)
    }

    if (!plan.supported) process.exitCode = 1
  }
})
