import { defineCommand } from 'citty'

import { bold, fail, fmtList, ok, printError } from '#cli/format'

import { fieldList, printNativeMotionDiagnostics, readNativeMotionSnapshot } from './native-common'

export default defineCommand({
  meta: {
    description: 'Inspect a detached Figma Motion readback snapshot without mutating Figma'
  },
  args: {
    snapshot: {
      type: 'positional',
      required: true,
      description: 'Detached Figma Motion snapshot JSON'
    },
    json: { type: 'boolean', default: false, description: 'Output the inspection report as JSON' }
  },
  async run({ args }) {
    try {
      const source = await readNativeMotionSnapshot(args.snapshot)
      const result = {
        version: 1 as const,
        source: { file: source.file },
        inspection: source.inspection,
        motion: source.imported.motion
      }
      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log('')
        console.log(bold('  Figma native Motion snapshot'))
        console.log('')
        console.log(
          fmtList(
            [
              {
                header: source.inspection.supported ? ok('supported') : fail('unsupported'),
                details: {
                  file: source.file,
                  source: source.inspection.source,
                  mirror: source.inspection.sharedMirror,
                  ownership: source.inspection.ownership,
                  fields: fieldList(source.inspection.fields),
                  timeline: source.inspection.timeline?.durationSeconds
                }
              }
            ],
            { compact: true }
          )
        )
        printNativeMotionDiagnostics(source.inspection.diagnostics)
        console.log('')
      }
      if (!source.inspection.supported) process.exitCode = 1
    } catch (error) {
      printError(error)
      process.exitCode = 1
    }
  }
})
