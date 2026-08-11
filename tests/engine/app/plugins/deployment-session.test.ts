import { describe, expect, test } from 'bun:test'

import {
  clearDeploymentPluginSession,
  deploymentPluginSessionSnapshot,
  isDeploymentPluginSessionActive,
  runDeploymentPluginSession
} from '@/app/plugins/host/deployment/session'

function result(deployId: string) {
  return {
    provider: 'vercel' as const,
    environment: 'preview' as const,
    url: `https://${deployId}.example.test`,
    deployId,
    fileCount: 3,
    serverDeploymentRequired: false
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
})
