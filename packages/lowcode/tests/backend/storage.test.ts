import { describe, expect, test } from 'bun:test'

import {
  deriveBackendApplicationCapabilities,
  parseBackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { backendApplicationFixture } from './fixture'

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`)
  return value
}

function ownerStorageApplication() {
  const application = backendApplicationFixture()
  application.storage = {
    version: 1,
    buckets: [
      {
        id: 'user-assets',
        name: 'user-assets',
        access: 'private',
        maxObjectBytes: 5_000_000,
        allowedMimeTypes: ['image/png', 'image/jpeg'],
        pathRules: [
          {
            id: 'user-assets-owner',
            prefix: ['users'],
            principal: { kind: 'owner' },
            operations: ['read', 'create', 'update', 'delete', 'upsert']
          }
        ]
      }
    ]
  }
  application.capabilities.push({ capability: 'storage.objects', required: true })
  return application
}

describe('Backend Storage IR', () => {
  test('normalizes deterministic owner storage and derives storage capability', () => {
    const application = ownerStorageApplication()
    application.storage?.buckets[0].allowedMimeTypes.reverse()
    application.storage?.buckets[0].pathRules[0].operations.reverse()

    const result = parseBackendApplicationSpecV1(application)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.storage).toEqual({
      version: 1,
      buckets: [
        expect.objectContaining({
          id: 'user-assets',
          allowedMimeTypes: ['image/jpeg', 'image/png'],
          pathRules: [
            expect.objectContaining({
              operations: ['read', 'create', 'update', 'delete', 'upsert']
            })
          ]
        })
      ]
    })
    expect(deriveBackendApplicationCapabilities(result.value)).toContain('storage.objects')
  })

  test('fails closed for unsafe bucket, MIME, prefix, size, empty rules, and unknown fields', () => {
    const cases: Array<(application: ReturnType<typeof ownerStorageApplication>) => void> = [
      (application) => {
        required(application.storage, 'storage').buckets[0].name = '../private'
      },
      (application) => {
        required(application.storage, 'storage').buckets[0].allowedMimeTypes = ['Image/PNG']
      },
      (application) => {
        required(application.storage, 'storage').buckets[0].pathRules[0].prefix = ['..']
      },
      (application) => {
        required(application.storage, 'storage').buckets[0].maxObjectBytes = 0
      },
      (application) => {
        required(application.storage, 'storage').buckets[0].pathRules = []
      },
      (application) => {
        Reflect.set(required(application.storage, 'storage').buckets[0], 'sql', 'using (true)')
      }
    ]

    for (const mutate of cases) {
      const application = ownerStorageApplication()
      mutate(application)
      expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    }
  })

  test('requires complete, existing tenant membership authority for tenant paths', () => {
    const application = ownerStorageApplication()
    required(application.storage, 'storage').buckets[0].pathRules[0].principal = {
      kind: 'tenant-member',
      tenantId: 'workspace'
    }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)

    application.dataModel.entities.push({
      id: 'memberships',
      name: 'memberships',
      management: 'managed',
      fields: [
        { id: 'user_id', name: 'user_id', type: 'uuid', nullable: false },
        { id: 'workspace_id', name: 'workspace_id', type: 'uuid', nullable: false }
      ],
      indexes: [
        { id: 'memberships_user_idx', fields: ['user_id'] },
        { id: 'memberships_workspace_idx', fields: ['workspace_id'] }
      ]
    })
    application.auth.tenants = [
      {
        id: 'workspace',
        entityId: 'notes',
        tenantFieldId: 'owner_id',
        membershipEntityId: 'memberships',
        membershipIdentityFieldId: 'user_id',
        membershipTenantFieldId: 'workspace_id'
      }
    ]

    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
  })

  test('keeps existing v1 documents without storage byte-compatible in shape', () => {
    const result = parseBackendApplicationSpecV1(backendApplicationFixture())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.hasOwn(result.value, 'storage')).toBe(false)
  })
})
