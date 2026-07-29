import { writeFile } from 'node:fs/promises'

import { defineCommand } from 'citty'

import {
  buildFigmaMotionPluginScript,
  createFigmaNativeMotionPlan,
  diffFigmaNativeMotion,
  type FigmaNativeMotionConflictPolicy,
  type FigmaNativeMotionDiff
} from '@open-pencil/fig'

import { dim, fail, fmtList, fmtNode, ok, printError } from '#cli/format'

import {
  createNativeMotionApplySnapshot,
  fieldList,
  loadNativeMotionSource,
  nativeMotionConflictPolicy,
  nativeMotionEmitMode,
  outputPath,
  printNativeMotionComparison,
  readNativeMotionSnapshot,
  type FigmaNativeMotionApplySnapshot,
  type NativeMotionEmitMode
} from './native-common'

interface ApplyReport {
  version: 1
  mode: NativeMotionEmitMode
  source: {
    file: string
    node: { id: string; name: string; type: string }
  }
  target: { mode: 'selection' } | { mode: 'node-id'; nodeId: string }
  safety: {
    generatedOnly: true
    conflictPolicy: FigmaNativeMotionConflictPolicy
    allowTimelineGrowth: boolean
    rawTimelineWrite: false
  }
  plan: ReturnType<typeof createFigmaNativeMotionPlan>
  comparison: FigmaNativeMotionDiff | null
  artifact: string | FigmaNativeMotionApplySnapshot | null
  output: string | null
}

export default defineCommand({
  meta: {
    description:
      'Plan or generate a Figma Motion apply artifact; never controls Figma Desktop directly'
  },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Source OpenPencil design document (.fig, .pen)'
    },
    node: {
      type: 'string',
      required: true,
      description: 'Source OpenPencil node ID containing MotionSpec data'
    },
    current: {
      type: 'string',
      description: 'Detached current Figma Motion snapshot JSON for compare-only diff'
    },
    emit: {
      type: 'string',
      default: 'plan',
      description: 'Artifact mode: plan (default), script, or snapshot'
    },
    'target-node': {
      type: 'string',
      description:
        'Target Figma node ID; omit to require exactly one selected node when a script runs'
    },
    'conflict-policy': {
      type: 'string',
      default: 'replace-owned',
      description: 'Conflict policy: replace-owned (default) or destructive replace-all'
    },
    'allow-timeline-growth': {
      type: 'boolean',
      default: false,
      description: 'Allow the generated runtime to extend an existing Figma timeline'
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Write the generated script or safe apply snapshot'
    },
    json: { type: 'boolean', default: false, description: 'Output the complete report as JSON' }
  },
  async run({ args }) {
    try {
      const mode = nativeMotionEmitMode(args.emit)
      const policy = nativeMotionConflictPolicy(args['conflict-policy'])
      const output = outputPath(args.output)
      if (mode === 'plan' && output) {
        throw new Error('--output requires --emit script or --emit snapshot')
      }
      const source = await loadNativeMotionSource(args.file, args.node)
      const plan = createFigmaNativeMotionPlan(source.node.motion, {
        nodeOpacity: source.node.opacity
      })
      const current = args.current ? await readNativeMotionSnapshot(args.current) : null
      const comparison = current ? diffFigmaNativeMotion(current.value, plan) : null
      const artifact = createArtifact({
        mode,
        plan,
        comparison,
        source,
        targetNodeId: args['target-node'],
        conflictPolicy: policy,
        allowTimelineGrowth: args['allow-timeline-growth']
      })
      if (artifact !== null && output !== null) {
        await writeFile(
          output,
          typeof artifact === 'string' ? artifact : JSON.stringify(artifact, null, 2) + '\n',
          'utf8'
        )
      }
      const report: ApplyReport = {
        version: 1,
        mode,
        source: {
          file: source.file,
          node: { id: source.node.id, name: source.node.name, type: source.node.type }
        },
        target: args['target-node']
          ? { mode: 'node-id', nodeId: args['target-node'] }
          : { mode: 'selection' },
        safety: {
          generatedOnly: true,
          conflictPolicy: policy,
          allowTimelineGrowth: args['allow-timeline-growth'],
          rawTimelineWrite: false
        },
        plan,
        comparison,
        artifact,
        output: artifact === null ? null : output
      }

      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
      } else if (artifact !== null && output === null && mode !== 'plan') {
        process.stdout.write(
          typeof artifact === 'string' ? artifact + '\n' : JSON.stringify(artifact, null, 2) + '\n'
        )
      } else {
        printApplyReport(report)
      }
      if (!plan.supported || comparison?.supported === false) process.exitCode = 1
    } catch (error) {
      printError(error)
      process.exitCode = 1
    }
  }
})

function createArtifact(input: {
  mode: NativeMotionEmitMode
  plan: ReturnType<typeof createFigmaNativeMotionPlan>
  comparison: FigmaNativeMotionDiff | null
  source: Awaited<ReturnType<typeof loadNativeMotionSource>>
  targetNodeId?: string
  conflictPolicy: FigmaNativeMotionConflictPolicy
  allowTimelineGrowth: boolean
}): string | FigmaNativeMotionApplySnapshot | null {
  if (input.mode === 'plan' || !input.plan.supported || input.comparison?.supported === false) {
    return null
  }
  if (input.mode === 'script') {
    return buildFigmaMotionPluginScript(input.plan, {
      nodeId: input.targetNodeId,
      conflictPolicy: input.conflictPolicy,
      allowTimelineGrowth: input.allowTimelineGrowth
    })
  }
  return createNativeMotionApplySnapshot(input.plan, input.source.node.motion, {
    targetNodeId: input.targetNodeId,
    conflictPolicy: input.conflictPolicy,
    allowTimelineGrowth: input.allowTimelineGrowth
  })
}

function printApplyReport(report: ApplyReport): void {
  const { node } = report.source
  console.log('')
  console.log(
    fmtNode(
      { type: node.type, name: node.name, id: node.id },
      {
        native: report.plan.supported ? ok('supported') : fail('unsupported'),
        mode: report.mode,
        fields: fieldList(report.plan.managedFields.map((field) => field.name)),
        duration:
          report.plan.durationSeconds === undefined
            ? undefined
            : String(report.plan.durationSeconds) + 's',
        boundary: 'generated only; Figma Desktop was not contacted'
      }
    )
  )
  const planDiagnostics = [
    ...report.plan.issues.map((issue) => ({
      header: fail(issue.code),
      details: { message: issue.message }
    })),
    ...report.plan.warnings.map((warning) => ({
      header: dim(warning.code),
      details: { message: warning.message }
    }))
  ]
  if (planDiagnostics.length > 0) {
    console.log('')
    console.log(fmtList(planDiagnostics, { numbered: false }))
  }
  printNativeMotionComparison(report.comparison)
  console.log('')
  if (report.output) console.log(ok('Wrote ' + report.output))
  else console.log(dim('Plan only; use --emit script or --emit snapshot to create an artifact.'))
  console.log('')
}
