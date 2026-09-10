import { describe, expect, test } from 'bun:test'

import { runDeployRuntimeScenario } from './helpers'

describe('direct CLI deployment runtime preflight', () => {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} rejects a production HTTP runtime before any provider request`, async () => {
      const result = await runDeployRuntimeScenario('production-http', target)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('supabase-production-https-required')
      expect(result.requests).toEqual([])
      expect(result.stdout).not.toContain('frontend-deployed')
    }, 30_000)

    test(`${target} accepts the effective HTTPS override and keeps Backend deployment required`, async () => {
      const result = await runDeployRuntimeScenario('http-to-https', target)

      expect(result.exitCode).toBe(0)
      expect(result.requests).toHaveLength(1)
      expect(result.stdout).toContain('"status": "frontend-deployed"')
      expect(result.stdout).toContain('"backendDeploymentRequired": true')
      expect(result.stdout).toContain(`"target": "${target}"`)
    }, 30_000)

    test(`${target} preserves ordinary static deployment`, async () => {
      const result = await runDeployRuntimeScenario('static', target)

      expect(result.exitCode).toBe(0)
      expect(result.requests).toHaveLength(1)
      expect(result.stdout).toContain('"status": "succeeded"')
      expect(result.stdout).toContain('"backendDeploymentRequired": false')
    }, 30_000)
  }

  test('rejects an HTTP override even when the design configuration uses HTTPS', async () => {
    const result = await runDeployRuntimeScenario('https-to-http', 'react')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('supabase-production-https-required')
    expect(result.requests).toEqual([])
  }, 30_000)

  test('cannot create an omitted Vue Supabase runtime by supplying an environment override', async () => {
    const result = await runDeployRuntimeScenario('missing-with-override', 'vue')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('supabase-config-required')
    expect(result.requests).toEqual([])
  }, 30_000)
})
