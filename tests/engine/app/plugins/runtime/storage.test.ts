import { describe, expect, test } from 'bun:test'

import {
  parsePluginRuntimePolicyRecord,
  type PluginRuntimePolicyRecordV1,
  type PluginRuntimePolicyRecordV2
} from '@/app/plugins/runtime'

function emptyPolicy(): PluginRuntimePolicyRecordV1 {
  return {
    schemaVersion: 1,
    pluginId: 'acme.analytics',
    declarativeManifestDigest: 'A'.repeat(43),
    runtimePackageDigest: 'Q'.repeat(43),
    grantedCapabilities: [],
    grantedAt: null,
    revokedAt: null,
    auditSequence: 0,
    audit: []
  }
}

describe('plugin runtime policy storage', () => {
  test('strictly persists marketplace authority in v2 while retaining legacy v1 records', () => {
    const authority = {
      sourceId: 'source:runtime',
      trustDomainId: 'trust-domain:runtime',
      sourceGeneration: 1,
      rootKeySpkiSha256: `sha256-${'A'.repeat(43)}`
    }
    const current: PluginRuntimePolicyRecordV2 = {
      ...emptyPolicy(),
      schemaVersion: 2,
      marketplaceAuthority: authority
    }
    expect(parsePluginRuntimePolicyRecord(current)).toMatchObject({
      schemaVersion: 2,
      marketplaceAuthority: authority
    })
    expect(parsePluginRuntimePolicyRecord(emptyPolicy())).not.toHaveProperty('marketplaceAuthority')
    expect(() =>
      parsePluginRuntimePolicyRecord({
        ...current,
        marketplaceAuthority: { ...authority, sourceGeneration: 0 }
      })
    ).toThrow('sourceGeneration')
    expect(() =>
      parsePluginRuntimePolicyRecord({
        ...current,
        marketplaceAuthority: { ...authority, extraAuthority: true }
      })
    ).toThrow('unexpected fields')
  })

  test('normalizes invalid persisted timestamps to a TypeError', () => {
    expect(() =>
      parsePluginRuntimePolicyRecord({
        ...emptyPolicy(),
        grantedAt: '2026-13-40T00:00:00.000Z'
      })
    ).toThrow(TypeError)
  })

  test('fails closed when persisted grant state disagrees with retained audit history', () => {
    const digest = 'Q'.repeat(43)
    const grantedAt = '2026-08-05T00:00:00.000Z'
    const revokedAt = '2026-08-05T00:01:00.000Z'
    const record: PluginRuntimePolicyRecordV1 = {
      ...emptyPolicy(),
      runtimePackageDigest: digest,
      grantedAt,
      revokedAt,
      auditSequence: 2,
      audit: [
        {
          sequence: 1,
          occurredAt: grantedAt,
          action: 'grant',
          runtimePackageDigest: digest,
          reasonCode: null
        },
        {
          sequence: 2,
          occurredAt: revokedAt,
          action: 'revoke',
          runtimePackageDigest: digest,
          reasonCode: null
        }
      ]
    }
    expect(() => parsePluginRuntimePolicyRecord({ ...record, revokedAt: null })).toThrow(
      'disagrees with its audit history'
    )
    expect(() =>
      parsePluginRuntimePolicyRecord({
        ...record,
        audit: [record.audit[1], record.audit[0]].map((event, index) => ({
          ...event,
          sequence: index + 1
        }))
      })
    ).toThrow('timestamps must be monotonic')
  })
})
