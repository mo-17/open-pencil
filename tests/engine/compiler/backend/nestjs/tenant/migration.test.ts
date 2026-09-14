import { expect, test } from 'bun:test'

import { validateLocalMigrationBoundary } from '#compiler/backend/nestjs/local-migration/boundary'

import { tenantApplication } from './helpers'

test('requires separate review when an existing preview changes tenant authority', () => {
  const from = tenantApplication()
  const to = structuredClone(from)
  expect(validateLocalMigrationBoundary(from, to)).toEqual([])
  to.auth.tenants[0].membershipIdentityFieldId = 'another-owner'
  expect(validateLocalMigrationBoundary(from, to)).toContainEqual(
    expect.objectContaining({
      code: 'backend-local-migration-tenant-change-blocked',
      severity: 'error'
    })
  )
})
