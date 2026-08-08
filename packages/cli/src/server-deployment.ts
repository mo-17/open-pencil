import { join, resolve } from 'node:path'

import {
  OPENPENCIL_SERVER_OUTPUT_DIR,
  type BuildResult,
  type ServerDeploymentInstructions
} from '@open-pencil/compiler/build'

import { bold, dim } from '#cli/format'

export type ManualServerDeploymentNotice = ServerDeploymentInstructions

const MANUAL_SERVER_WARNING =
  'Server workflows were generated but were not deployed. OpenPencil does not upload server code or configure server secrets automatically.'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function deployCommand(artifactDirectory: string): string {
  return 'supabase functions deploy openpencil-runtime --workdir ' + shellQuote(artifactDirectory)
}

/** Instructions for the durable server bundle produced by `open-pencil build`. */
export function createBuildServerDeploymentNotice(
  result: Pick<BuildResult, 'outDir' | 'serverFiles'>
): ManualServerDeploymentNotice | undefined {
  if (result.serverFiles.length === 0) return undefined
  const artifactDirectory = join(result.outDir, OPENPENCIL_SERVER_OUTPUT_DIR)
  return {
    required: true,
    warning: MANUAL_SERVER_WARNING,
    artifactDirectory,
    commands: [deployCommand(artifactDirectory)]
  }
}

/**
 * A static `deploy` builds in a disposable directory. Give the operator a
 * reproducible build command whose output survives after the static upload.
 */
export function createDeployServerDeploymentNotice(
  sourceFile: string,
  buildDirectory = resolve('openpencil-build')
): ManualServerDeploymentNotice {
  const artifactDirectory = join(buildDirectory, OPENPENCIL_SERVER_OUTPUT_DIR)
  return {
    required: true,
    warning: MANUAL_SERVER_WARNING,
    artifactDirectory,
    commands: [
      `bun open-pencil build ${shellQuote(sourceFile)} -o ${shellQuote(buildDirectory)}`,
      deployCommand(artifactDirectory)
    ]
  }
}

export function printManualServerDeploymentNotice(notice: ManualServerDeploymentNotice): void {
  console.log('')
  console.log(bold('  Manual server deployment required'))
  console.log(dim(`  ${notice.warning}`))
  console.log('')
  for (const command of notice.commands) console.log(`  ${command}`)
}
