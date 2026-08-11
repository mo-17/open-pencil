import { shallowRef } from 'vue'

import type { DeploymentPluginResult } from './provider'
import { boundedDeploymentText } from './text'

export type DeploymentPluginSessionStatus = 'deploying' | 'succeeded' | 'failed'

export interface DeploymentPluginSessionState {
  readonly pluginId: string
  readonly status: DeploymentPluginSessionStatus
  readonly documentScope: string
  readonly documentLabel: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly result?: DeploymentPluginResult
  readonly notice?: string
  readonly error?: string
}

export interface DeploymentPluginSessionCompletion {
  readonly result: DeploymentPluginResult
  readonly notice?: string
}

export interface RunDeploymentPluginSessionOptions {
  readonly pluginId: string
  readonly documentScope: string
  readonly documentLabel: string
  readonly operation: () => Promise<DeploymentPluginSessionCompletion>
}

const MAX_SESSION_TEXT = 512

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
    startedAt
  })
  try {
    const completion = await options.operation()
    setSession({
      pluginId: options.pluginId,
      status: 'succeeded',
      documentScope: options.documentScope,
      documentLabel: boundedSessionText(options.documentLabel, 'Saved OpenPencil document'),
      startedAt,
      finishedAt: new Date().toISOString(),
      result: completion.result,
      ...(completion.notice
        ? {
            notice: boundedSessionText(completion.notice, 'Deployment completed with a warning.')
          }
        : {})
    })
    return completion
  } catch (cause) {
    setSession({
      pluginId: options.pluginId,
      status: 'failed',
      documentScope: options.documentScope,
      documentLabel: boundedSessionText(options.documentLabel, 'Saved OpenPencil document'),
      startedAt,
      finishedAt: new Date().toISOString(),
      error: boundedSessionText(cause, 'Deployment failed.')
    })
    throw cause
  }
}
