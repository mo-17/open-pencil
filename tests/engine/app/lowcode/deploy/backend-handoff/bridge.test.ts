import { describe, expect, test } from 'bun:test'

import { runBackendHandoffBridge } from './helpers'

describe('reviewed Backend Provider through the actual Desktop runner and CLI', () => {
  for (const scenario of ['success', 'fragmented'] as const) {
    test(`${scenario} builds the reviewed managed model through the real .fig handoff`, async () => {
      const result = await runBackendHandoffBridge(scenario)

      expect(result.exitCode).toBe(0)
      expect(result.report.error).toBeUndefined()
      expect(result.report.markerCount).toBe(1)
      expect(result.report.legacyHasBackendManifest).toBe(false)
      expect(result.report.result).toMatchObject({
        provider: 'vercel',
        environment: 'production',
        url: 'https://local-handoff.invalid',
        backendDeploymentRequired: true
      })
      const observed = result.requests.find((request) => request.url.endsWith('/v13/deployments'))
      if (!observed) throw new Error('Expected the actual Vercel deployment request')
      expect(result.requests).toHaveLength(observed.staticPaths.length + 1)
      const reviewed = result.report.review.backendProvider
      expect(reviewed).toBeDefined()
      expect(observed.manifest.applicationDigest).toBe(reviewed?.applicationDigest)
      expect(observed.manifest.planDigest).toBe(reviewed?.planDigest)
      expect(observed.manifestDigest).toBe(reviewed?.manifestDigest)
      expect(observed.manifest.authority.packageDigest).toBe(reviewed?.packageDigest)
      expect(observed.manifest.target).toBe('react')
      expect(observed.migrationProposal).toContain('"name": "reviewed_notes"')
      expect(observed.migrationProposal).toContain('"management": "managed"')
      expect(observed.migrationProposal).toContain('"applyAllowed": false')
      expect(observed.staticPaths).toContain('/index.html')
      expect(observed.staticPaths.some((path) => path.includes('openpencil-server'))).toBe(false)
      expect(observed.staticPaths.some((path) => path.includes('backend/'))).toBe(false)
      expect(result.events.indexOf('confirmed')).toBeLessThan(result.events.indexOf('spawn'))
      expect(result.events.indexOf('handoff')).toBeLessThan(result.events.indexOf('ready'))
      expect(result.events.indexOf('ready')).toBeLessThan(result.events.indexOf('authorize'))
      expect(result.events.indexOf('authorize')).toBeLessThan(
        result.events.findIndex((event) => event.startsWith('provider:POST:'))
      )
      expect(result.temporaryEntries).toEqual([])
      expect(result.stdout + result.stderr).not.toContain('test-only-test-only')
    }, 45_000)
  }

  for (const scenario of ['disabled-ready', 'changed-ready'] as const) {
    test(`${scenario} is rejected by the live Host after compilation and before upload`, async () => {
      const result = await runBackendHandoffBridge(scenario)

      expect(result.exitCode).toBe(0)
      expect(result.report.result).toBeUndefined()
      expect(result.report.error?.name).toBe('DeploymentPluginError')
      expect(result.report.error?.code).toBe(
        scenario === 'disabled-ready' ? 'backend-provider-unavailable' : 'review-changed'
      )
      expect(result.events).toContain('ready')
      expect(result.events).toContain(scenario === 'disabled-ready' ? 'disabled' : 'changed')
      expect(result.events).not.toContain('authorize')
      expect(result.events).toContain('cancel')
      expect(result.events.some((event) => event.startsWith('provider:'))).toBe(false)
      expect(result.requests).toEqual([])
      expect(result.temporaryEntries).toEqual([])
      expect(result.stdout + result.stderr).not.toContain('test-only-test-only')
    }, 45_000)
  }

  test('an early shell failure remains distinct from a provider failure after authorization', async () => {
    const early = await runBackendHandoffBridge('spawn-failure')
    const dispatched = await runBackendHandoffBridge('provider-failure')

    expect(early.report.error?.code).toBe('backend-provider-build-failed')
    expect(early.events).not.toContain('authorize')
    expect(early.requests).toEqual([])
    expect(early.temporaryEntries).toEqual([])
    expect(dispatched.report.error?.code).toBe('outcome-unknown')
    expect(dispatched.events).toContain('authorize')
    expect(dispatched.requests).toHaveLength(1)
    expect(dispatched.temporaryEntries).toEqual([])
    expect(dispatched.report.result).toBeUndefined()
  }, 45_000)

  for (const scenario of ['raw-react', 'raw-vue'] as const) {
    test(`${scenario} cannot turn a saved marker into Compiler authority`, async () => {
      const result = await runBackendHandoffBridge(scenario)

      expect(result.exitCode).toBe(1)
      expect(result.report.markerCount).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Backend Provider')
      expect(result.requests).toEqual([])
      expect(result.events.some((event) => event.startsWith('provider:'))).toBe(false)
      expect(result.temporaryEntries).toEqual([])
      expect(result.stdout + result.stderr).not.toContain('test-only-test-only')
    }, 45_000)
  }
})
