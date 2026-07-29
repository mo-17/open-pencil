import { writeFile } from 'node:fs/promises'

import { defineCommand } from 'citty'

import { diffFigmaNativeMotion, type FigmaNativeMotionDiff } from '@open-pencil/fig'

import { bold, dim, fail, fmtList, ok, printError } from '#cli/format'

import {
  createNativeMotionClearSnapshot,
  outputPath,
  printNativeMotionComparison,
  readNativeMotionSnapshot,
  type FigmaNativeMotionClearSnapshot,
  type NativeMotionSnapshotFile
} from './native-common'

type ClearEmitMode = 'plan' | 'snapshot'

interface ClearReport {
  version: 1
  mode: ClearEmitMode
  source: { file: string } | null
  safety: {
    generatedOnly: true
    compareOnly: true
    rawTimelineWrite: false
    nativeClearRequiresVerifiedOwnership: true
  }
  comparison: FigmaNativeMotionDiff | null
  artifact: FigmaNativeMotionClearSnapshot | null
  output: string | null
}

export default defineCommand({
  meta: {
    description:
      'Plan a canonical Motion clear or emit a safe clear snapshot without mutating Figma'
  },
  args: {
    current: {
      type: 'positional',
      required: false,
      description: 'Detached current Figma Motion snapshot JSON for compare-only verification'
    },
    emit: {
      type: 'string',
      default: 'plan',
      description: 'Artifact mode: plan (default) or snapshot'
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Write the safe clear snapshot'
    },
    json: { type: 'boolean', default: false, description: 'Output the complete report as JSON' }
  },
  async run({ args }) {
    try {
      const mode = clearEmitMode(args.emit)
      const output = outputPath(args.output)
      if (mode === 'plan' && output) {
        throw new Error('--output requires --emit snapshot')
      }
      const current = args.current ? await readNativeMotionSnapshot(args.current) : null
      const comparison = current ? diffFigmaNativeMotion(current.value, null) : null
      const artifact =
        mode === 'snapshot' && comparison?.supported !== false
          ? createNativeMotionClearSnapshot(current)
          : null
      if (artifact && output) {
        await writeFile(output, JSON.stringify(artifact, null, 2) + '\n', 'utf8')
      }
      const report: ClearReport = {
        version: 1,
        mode,
        source: current ? { file: current.file } : null,
        safety: {
          generatedOnly: true,
          compareOnly: true,
          rawTimelineWrite: false,
          nativeClearRequiresVerifiedOwnership: true
        },
        comparison,
        artifact,
        output: artifact === null ? null : output
      }
      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
      } else if (artifact && output === null) {
        process.stdout.write(JSON.stringify(artifact, null, 2) + '\n')
      } else {
        printClearReport(report, current)
      }
      if (comparison?.supported === false) process.exitCode = 1
    } catch (error) {
      printError(error)
      process.exitCode = 1
    }
  }
})

function clearEmitMode(value: string): ClearEmitMode {
  if (value === 'plan' || value === 'snapshot') return value
  throw new Error('Unknown clear emit mode "' + value + '". Expected plan or snapshot.')
}

function printClearReport(report: ClearReport, current: NativeMotionSnapshotFile | null): void {
  console.log('')
  console.log(bold('  Figma native Motion clear plan'))
  console.log('')
  console.log(
    fmtList(
      [
        {
          header: report.comparison?.supported === false ? fail('blocked') : ok('compare-only'),
          details: {
            source: report.source?.file ?? 'none',
            ownership: current?.inspection.ownership ?? 'not inspected',
            native:
              current?.inspection.ownership === 'valid'
                ? 'remove verified owned fields'
                : 'preserve unverified fields',
            timeline: 'preserve',
            boundary: 'generated only; Figma Desktop was not contacted'
          }
        }
      ],
      { compact: true }
    )
  )
  printNativeMotionComparison(report.comparison)
  console.log('')
  if (report.output) console.log(ok('Wrote ' + report.output))
  else console.log(dim('Plan only; use --emit snapshot to create a guarded clear artifact.'))
  console.log('')
}
