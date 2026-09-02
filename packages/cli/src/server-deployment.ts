import { join, resolve } from 'node:path'

import {
  OPENPENCIL_SERVER_OUTPUT_DIR,
  type BuildResult,
  type ServerDeploymentInstructions
} from '@open-pencil/compiler/build'

import { bold, dim } from '#cli/format'

export interface ManualServerDeploymentNotice extends ServerDeploymentInstructions {
  backendReviewRequired: boolean
  serverRuntimeDeploymentRequired: boolean
}

const MANUAL_SERVER_WARNING =
  'Server workflows were generated but were not deployed. OpenPencil does not upload server code or configure server secrets automatically.'
const MANUAL_BACKEND_REVIEW_WARNING =
  'Backend Provider review artifacts were generated but were not applied. Static hosting does not modify remote schema, RLS, storage policy, or Backend runtime.'
const MANUAL_BACKEND_AND_SERVER_WARNING = `${MANUAL_BACKEND_REVIEW_WARNING} ${MANUAL_SERVER_WARNING}`

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function deployCommand(artifactDirectory: string): string {
  return 'supabase functions deploy openpencil-runtime --workdir ' + shellQuote(artifactDirectory)
}

function deploymentWarning(
  backendReviewRequired: boolean,
  serverRuntimeDeploymentRequired: boolean
): string {
  if (backendReviewRequired && serverRuntimeDeploymentRequired) {
    return MANUAL_BACKEND_AND_SERVER_WARNING
  }
  if (backendReviewRequired) return MANUAL_BACKEND_REVIEW_WARNING
  return MANUAL_SERVER_WARNING
}

/** Instructions for the durable server bundle produced by `open-pencil build`. */
export function createBuildServerDeploymentNotice(
  result: Pick<BuildResult, 'outDir' | 'serverFiles'> &
    Partial<Pick<BuildResult, 'backendReviewFiles' | 'executableServerWorkflowFiles'>>
): ManualServerDeploymentNotice | undefined {
  if (result.serverFiles.length === 0) return undefined
  const artifactDirectory = join(result.outDir, OPENPENCIL_SERVER_OUTPUT_DIR)
  const backendReviewRequired = (result.backendReviewFiles?.length ?? 0) > 0
  const classificationsPresent =
    result.backendReviewFiles !== undefined || result.executableServerWorkflowFiles !== undefined
  const serverRuntimeDeploymentRequired = classificationsPresent
    ? (result.executableServerWorkflowFiles?.length ?? 0) > 0
    : true
  return {
    required: true,
    warning: deploymentWarning(backendReviewRequired, serverRuntimeDeploymentRequired),
    artifactDirectory,
    commands: serverRuntimeDeploymentRequired ? [deployCommand(artifactDirectory)] : [],
    backendReviewRequired,
    serverRuntimeDeploymentRequired
  }
}

/**
 * A static `deploy` builds in a disposable directory. Give the operator a
 * reproducible build command whose output survives after the static upload.
 */
export function createDeployServerDeploymentNotice(
  sourceFile: string,
  buildDirectory = resolve('openpencil-build'),
  result?: Pick<BuildResult, 'serverFiles' | 'backendReviewFiles' | 'executableServerWorkflowFiles'>
): ManualServerDeploymentNotice {
  const artifactDirectory = join(buildDirectory, OPENPENCIL_SERVER_OUTPUT_DIR)
  const backendReviewRequired = (result?.backendReviewFiles.length ?? 0) > 0
  const serverRuntimeDeploymentRequired = result
    ? result.executableServerWorkflowFiles.length > 0
    : true
  return {
    required: true,
    warning: deploymentWarning(backendReviewRequired, serverRuntimeDeploymentRequired),
    artifactDirectory,
    commands: [
      `bun open-pencil build ${shellQuote(sourceFile)} -o ${shellQuote(buildDirectory)}`,
      ...(serverRuntimeDeploymentRequired ? [deployCommand(artifactDirectory)] : [])
    ],
    backendReviewRequired,
    serverRuntimeDeploymentRequired
  }
}

export function printManualServerDeploymentNotice(notice: ManualServerDeploymentNotice): void {
  console.log('')
  console.log(bold('  Manual Backend action required'))
  console.log(dim(`  ${notice.warning}`))
  console.log('')
  for (const command of notice.commands) console.log(`  ${command}`)
}
