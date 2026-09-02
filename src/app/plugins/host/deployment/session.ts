import { shallowRef } from 'vue'

import type { BackendReleaseStateV1 } from '@open-pencil/lowcode/backend'

import { DeploymentPluginError, type DeploymentPluginResult } from './provider'
import { boundedDeploymentText } from './text'

export type DeploymentPluginSessionStatus =
  | 'deploying'
  | 'frontend-deployed'
  | 'succeeded'
  | 'outcome-unknown'
  | 'failed'

export interface DeploymentPluginSessionState {
  readonly pluginId: string
  readonly status: DeploymentPluginSessionStatus
  readonly documentScope: string
  readonly documentLabel: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly automaticRetryAllowed: boolean
  readonly reconcileRequired: boolean
  readonly result?: DeploymentPluginResult
  readonly backendRelease?: BackendReleaseStateV1
  readonly notice?: string
  readonly error?: string
}

export interface DeploymentPluginSessionCompletion {
  readonly result: DeploymentPluginResult
  readonly backendRelease?: BackendReleaseStateV1
  readonly notice?: string
}

export interface RunDeploymentPluginSessionOptions {
  readonly pluginId: string
  readonly documentScope: string
  readonly documentLabel: string
  readonly operation: () => Promise<DeploymentPluginSessionCompletion>
}

const MAX_SESSION_TEXT = 512
const BACKEND_DEPLOYMENT_REQUIRED_NOTICE =
  'Static frontend deployment completed, but the backend deployment has not been verified. Deploy and verify the backend before treating the application as complete.'

export const deploymentPluginSessionSnapshot = shallowRef<
  Readonly<Record<string, DeploymentPluginSessionState | undefined>>
>(Object.freeze({}))

function boundedSessionText(value: unknown, fallback: string): string {
  return boundedDeploymentText(value, fallback, MAX_SESSION_TEXT, {
    countUtf16CodeUnits: true
  })
}

function setSession(state: DeploymentPluginSessionState): void {
  deploymentPluginSessionSnapshot.value = Object.freeze({
    ...deploymentPluginSessionSnapshot.value,
    [state.pluginId]: Object.freeze(state)
  })
}

export function isDeploymentPluginSessionActive(pluginId: string): boolean {
  return deploymentPluginSessionSnapshot.value[pluginId]?.status === 'deploying'
}

export function clearDeploymentPluginSession(pluginId: string): void {
  if (isDeploymentPluginSessionActive(pluginId)) {
    throw new Error('An active deployment session cannot be cleared.')
  }
  const { [pluginId]: _removed, ...remaining } = deploymentPluginSessionSnapshot.value
  deploymentPluginSessionSnapshot.value = Object.freeze(remaining)
}

/**
 * Keep remote deployment state outside the Settings component so closing or
 * switching Settings cannot orphan feedback or allow the plugin to be removed
 * while its provider operation is still in flight. No credentials are retained.
 */
export async function runDeploymentPluginSession(
  options: RunDeploymentPluginSessionOptions
): Promise<DeploymentPluginSessionCompletion> {
  if (isDeploymentPluginSessionActive(options.pluginId)) {
    throw new Error('A deployment for this plugin is already running.')
  }
  const startedAt = new Date().toISOString()
  setSession({
    pluginId: options.pluginId,
    status: 'deploying',
    documentScope: options.documentScope,
    documentLabel: boundedSessionText(options.documentLabel, 'Saved OpenPencil document'),
    startedAt,
    automaticRetryAllowed: false,
    reconcileRequired: false
  })
  try {
    const completion = await options.operation()
    const backendDeploymentRequired = completion.result.backendDeploymentRequired
    const combinedNotice = [
      completion.notice,
      ...(backendDeploymentRequired ? [BACKEND_DEPLOYMENT_REQUIRED_NOTICE] : [])
    ]
      .filter(Boolean)
      .join(' ')
    const resolvedCompletion = Object.freeze({
      result: completion.result,
      ...(completion.backendRelease ? { backendRelease: completion.backendRelease } : {}),
      ...(combinedNotice
        ? { notice: boundedSessionText(combinedNotice, BACKEND_DEPLOYMENT_REQUIRED_NOTICE) }
        : {})
    })
    setSession({
      pluginId: options.pluginId,
      status: backendDeploymentRequired ? 'frontend-deployed' : 'succeeded',
      documentScope: options.documentScope,
      documentLabel: boundedSessionText(options.documentLabel, 'Saved OpenPencil document'),
      startedAt,
      finishedAt: new Date().toISOString(),
      automaticRetryAllowed: false,
      reconcileRequired: false,
      result: resolvedCompletion.result,
      ...(resolvedCompletion.backendRelease
        ? { backendRelease: resolvedCompletion.backendRelease }
        : {}),
      ...(resolvedCompletion.notice
        ? {
            notice: resolvedCompletion.notice
          }
        : {})
    })
    return resolvedCompletion
  } catch (cause) {
    const outcomeUnknown =
      cause instanceof DeploymentPluginError && cause.code === 'outcome-unknown'
    setSession({
      pluginId: options.pluginId,
      status: outcomeUnknown ? 'outcome-unknown' : 'failed',
      documentScope: options.documentScope,
      documentLabel: boundedSessionText(options.documentLabel, 'Saved OpenPencil document'),
      startedAt,
      finishedAt: new Date().toISOString(),
      automaticRetryAllowed: false,
      reconcileRequired: outcomeUnknown,
      error: boundedSessionText(cause, 'Deployment failed.')
    })
    throw cause
  }
}
