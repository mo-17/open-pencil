import { describe, expect, test } from 'bun:test'

import { supabaseAllowPolicyPredicate } from '#compiler/backend/supabase/policy-helpers'
import { validateSupabaseBackendProvider } from '#compiler/backend/supabase/validation'

import {
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  evaluateSupabaseRowAccess
} from '@open-pencil/compiler/backend'
import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { tenantApplication, STORE } from '../nestjs/tenant/helpers'

describe('provider boundary for the bounded tenant extension', () => {
  test.each(['production', 'source-only-prototype'] as const)(
    'rejects unsupported tenant roles, selectors and read subsets in %s mode',
    (mode) => {
      const application = tenantApplication()
      if (!application.httpApi) throw new Error('Missing API')
      application.httpApi.resources[0].readPolicyIds = ['merchant-notes']
      const parsed = parseBackendApplicationSpecV1(application)
      expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
      const diagnostics = validateSupabaseBackendProvider({
        application,
        selection: {
          descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
          packageDigest: `app-bundle-sha256:${'A'.repeat(43)}`,
          enabled: true
        },
        target: 'react',
        mode,
        capabilities: []
      })
      for (const code of [
        'supabase-http-read-policy-unimplemented',
        'supabase-tenant-role-unimplemented',
        'supabase-tenant-selector-unimplemented'
      ])
        expect(diagnostics).toContainEqual(expect.objectContaining({ code, severity: 'error' }))
    }
  )

  test('does not downgrade tenant AND role into tenant-only SQL or policy evaluation', () => {
    const app = tenantApplication()
    const policy = app.auth.rowAccess.find((entry) => entry.id === 'merchant-notes')
    if (!policy) throw new Error('Missing tenant policy')
    app.auth.rowAccess = [policy]
    expect(
      supabaseAllowPolicyPredicate(app, app.dataModel.entities[0], policy.principal)
    ).toBeUndefined()
    expect(
      evaluateSupabaseRowAccess(app, {
        entityId: app.dataModel.entities[0].id,
        operation: 'select',
        actor: {
          authenticated: true,
          userId: 'member',
          roleNames: ['merchant'],
          tenantMemberships: { 'notes-store': [STORE] }
        },
        row: { store_id: STORE, owner_id: 'member' }
      })
    ).toBe(false)
    if (policy.principal.kind !== 'tenant-member') throw new Error('Missing tenant principal')
    delete policy.principal.roleId
    expect(
      supabaseAllowPolicyPredicate(app, app.dataModel.entities[0], policy.principal)
    ).toContain('exists (select 1')
    expect(
      evaluateSupabaseRowAccess(app, {
        entityId: app.dataModel.entities[0].id,
        operation: 'select',
        actor: {
          authenticated: true,
          userId: 'member',
          tenantMemberships: { 'notes-store': [STORE] }
        },
        row: { store_id: STORE }
      })
    ).toBe(true)
  })
})
