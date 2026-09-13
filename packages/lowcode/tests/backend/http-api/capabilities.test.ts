import { describe, expect, test } from 'bun:test'

import {
  deriveBackendApplicationCapabilities,
  deriveBackendApplicationCapabilitiesV2,
  parseBackendApplicationSpecV1,
  parseBackendApplicationSpecV2,
  validateBackendCapabilityDeclarations,
  validateBackendCapabilityDeclarationsV2
} from '@open-pencil/lowcode/backend'

import { httpApplication, httpApplicationV2, httpResource } from './fixtures'

describe('Backend HTTP API actual-use capability requirements', () => {
  test('derives HTTP, identity and only the data access actually used by resources', () => {
    const application = httpApplication()
    expect(deriveBackendApplicationCapabilities(application)).toEqual([
      'auth.identity',
      'data.read',
      'data.write',
      'migrations.schema',
      'policy.row-level',
      'server.http'
    ])
    application.httpApi.resources = [httpResource('list', '/api/notes', ['list'])]
    expect(deriveBackendApplicationCapabilities(application)).toEqual([
      'auth.identity',
      'data.read',
      'migrations.schema',
      'policy.row-level',
      'server.http'
    ])
    const v2 = httpApplicationV2()
    expect(deriveBackendApplicationCapabilitiesV2(v2)).toContain('server.http')
    expect(deriveBackendApplicationCapabilitiesV2(v2)).not.toContain('server.functions')
  })

  test('rejects absent or optional declarations for HTTP capability use in both versions', () => {
    for (const capability of ['server.http', 'auth.identity', 'data.read', 'data.write'] as const) {
      for (const optional of [false, true]) {
        const v1 = httpApplication()
        const v2 = httpApplicationV2()
        for (const application of [v1, v2]) {
          application.capabilities = application.capabilities.filter(
            (entry) => entry.capability !== capability
          )
          if (optional) application.capabilities.push({ capability, required: false })
        }
        const expected = expect.objectContaining({
          code: optional
            ? 'backend-capability-use-not-required'
            : 'backend-capability-use-undeclared',
          path: `$.capabilities.${capability}`,
          severity: 'error'
        })
        // V1 deliberately keeps parsing separate from its existing capability gate.
        expect(parseBackendApplicationSpecV1(v1).ok).toBe(true)
        expect(validateBackendCapabilityDeclarations(v1)).toContainEqual(expected)
        expect(validateBackendCapabilityDeclarationsV2(v2)).toContainEqual(expected)
        expect(parseBackendApplicationSpecV2(v2).ok).toBe(false)
      }
    }
  })
})
