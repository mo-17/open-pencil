import { describe, expect, test } from 'bun:test'

import { runDeployRuntimeScenario } from './helpers'

describe('direct CLI deployment failure cleanup', () => {
  // These failures occur after successful compilation. loadAndCompile's own
  // hard exits remain outside this cleanup contract.
  for (const target of ['react', 'vue'] as const) {
    for (const failure of [
      {
        scenario: 'incomplete-override',
        message:
          'Supabase URL and publishable/anon key overrides must be provided together to avoid mixing projects.',
        requests: []
      },
      {
        scenario: 'provider-failure',
        message:
          'API POST https://api.netlify.com/api/v1/sites/local-preflight-site/deploys failed: 503 — fixture service unavailable',
        requests: [
          JSON.stringify({
            url: 'https://api.netlify.com/api/v1/sites/local-preflight-site/deploys',
            method: 'POST'
          })
        ]
      }
    ] as const) {
      test(`${target} removes owned temporary files after ${failure.scenario}`, async () => {
        const result = await runDeployRuntimeScenario(failure.scenario, target)

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain(failure.message)
        expect(result.requests).toEqual(failure.requests)
        expect(result.stdout).not.toContain('"status"')
        expect(result.stdout).not.toContain('"provider"')
        const output = result.stdout + result.stderr
        expect(output).not.toContain('local-fixture-not-a-real-token')
        expect(output).not.toContain('https://override.supabase.co')
        expect(output).not.toContain('sb_publishable_override_fixture')
        expect(result.temporaryEntries).toEqual([])
      }, 30_000)
    }
  }
})
