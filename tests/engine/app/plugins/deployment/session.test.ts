import { describe, expect, test } from 'bun:test'

import { DeploymentPluginError } from '@/app/plugins/host/deployment/provider'
import {
  clearDeploymentPluginSession,
  deploymentPluginSessionSnapshot,
  isDeploymentPluginSessionActive,
  runDeploymentPluginSession
} from '@/app/plugins/host/deployment/session'

function result(deployId: string, backendDeploymentRequired = false) {
  return {
    provider: 'vercel' as const,
    environment: 'preview' as const,
    url: `https://${deployId}.example.test`,
    deployId,
    fileCount: 3,
    backendDeploymentRequired
  }
}

describe('deployment plugin session lifecycle', () => {
  test('survives UI lifetimes without retaining credentials', async () => {
    const gate = Promise.withResolvers<undefined>()
    const pending = runDeploymentPluginSession({
      pluginId: 'test.deployment.session.success',
      documentScope: 'path:reviewed.fig',
      documentLabel: 'reviewed.fig',
      operation: async () => {
        await gate.promise
        return { result: result('deploy-1'), notice: 'History remains on reviewed.fig.' }
      }
    })

    expect(isDeploymentPluginSessionActive('test.deployment.session.success')).toBe(true)
    expect(deploymentPluginSessionSnapshot.value['test.deployment.session.success']).toMatchObject({
      status: 'deploying',
      documentScope: 'path:reviewed.fig',
      documentLabel: 'reviewed.fig'
    })
    expect(JSON.stringify(deploymentPluginSessionSnapshot.value)).not.toContain('token')

    gate.resolve(undefined)
    await expect(pending).resolves.toEqual({
      result: result('deploy-1'),
      notice: 'History remains on reviewed.fig.'
    })
    expect(isDeploymentPluginSessionActive('test.deployment.session.success')).toBe(false)
    expect(deploymentPluginSessionSnapshot.value['test.deployment.session.success']).toMatchObject({
      status: 'succeeded',
      result: result('deploy-1')
    })
    clearDeploymentPluginSession('test.deployment.session.success')
    expect(deploymentPluginSessionSnapshot.value['test.deployment.session.success']).toBeUndefined()
  })

  test('records static frontend success as partial while backend deployment is required', async () => {
    const pluginId = 'test.deployment.session.backend-required'
    const completion = await runDeploymentPluginSession({
      pluginId,
      documentScope: 'scope-backend',
      documentLabel: 'backend.fig',
      operation: async () => ({ result: result('frontend-only', true) })
    })

    expect(completion.result.backendDeploymentRequired).toBe(true)
    expect(completion.notice).toContain('backend deployment has not been verified')
    expect(deploymentPluginSessionSnapshot.value[pluginId]).toMatchObject({
      status: 'frontend-deployed',
      result: { backendDeploymentRequired: true },
      notice: expect.stringContaining('application as complete')
    })
    expect(deploymentPluginSessionSnapshot.value[pluginId]?.status).not.toBe('succeeded')
    clearDeploymentPluginSession(pluginId)
  })

  test('rejects overlapping runs and keeps a bounded failure for reopened settings', async () => {
    const gate = Promise.withResolvers<undefined>()
    const pluginId = 'test.deployment.session.failure'
    const pending = runDeploymentPluginSession({
      pluginId,
      documentScope: 'scope-2',
      documentLabel: 'unsafe\u0000label.fig',
      operation: async () => {
        await gate.promise
        throw new Error(`provider failed\u0000${'😀'.repeat(1_000)}`)
      }
    })
    await expect(
      runDeploymentPluginSession({
        pluginId,
        documentScope: 'scope-2',
        documentLabel: 'other.fig',
        operation: async () => ({ result: result('overlap') })
      })
    ).rejects.toThrow('already running')
    expect(() => clearDeploymentPluginSession(pluginId)).toThrow('cannot be cleared')

    gate.resolve(undefined)
    await expect(pending).rejects.toThrow('provider failed')
    const state = deploymentPluginSessionSnapshot.value[pluginId]
    expect(state?.status).toBe('failed')
    expect(state?.documentLabel).toBe('unsafe label.fig')
    expect(state?.error).not.toContain('\u0000')
    expect(state?.error?.length).toBeLessThanOrEqual(512)
  })

  test('preserves an unknown post-dispatch outcome and forbids automatic retry', async () => {
    const pluginId = 'test.deployment.session.outcome-unknown'
    await expect(
      runDeploymentPluginSession({
        pluginId,
        documentScope: 'scope-unknown',
        documentLabel: 'unknown.fig',
        operation: async () => {
          throw new DeploymentPluginError(
            'outcome-unknown',
            'Frontend dispatch lost its transport acknowledgement.'
          )
        }
      })
    ).rejects.toMatchObject({ code: 'outcome-unknown' })

    expect(deploymentPluginSessionSnapshot.value[pluginId]).toMatchObject({
      status: 'outcome-unknown',
      automaticRetryAllowed: false,
      reconcileRequired: true,
      error: 'Frontend dispatch lost its transport acknowledgement.'
    })
    expect(isDeploymentPluginSessionActive(pluginId)).toBe(false)
    clearDeploymentPluginSession(pluginId)
  })
})
