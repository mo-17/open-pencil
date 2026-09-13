import { describe, expect, test } from 'bun:test'

import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  backendProviderPlanDigest,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  type BackendProviderPlan
} from '@open-pencil/compiler/backend'
import {
  digestBackendApplication,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { nestJSApplication } from './helpers'

const SELECTION = {
  descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  packageDigest: `sha256:${'A'.repeat(43)}`,
  enabled: true
}

function twoEntities(secondName: string, firstName = 'notes') {
  const application = structuredClone(nestJSApplication())
  if (!application.httpApi) throw new Error('Expected explicit HTTP fixture')
  application.dataModel.entities[0].name = firstName
  application.dataModel.entities.push({
    ...structuredClone(application.dataModel.entities[0]),
    id: 'secondary',
    name: secondName
  })
  application.auth.ownership.push({
    id: 'secondary-owner',
    entityId: 'secondary',
    identityFieldId: 'owner_id'
  })
  application.auth.rowAccess.push({
    id: 'secondary-select',
    entityId: 'secondary',
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'owner', ownershipId: 'secondary-owner' }
  })
  application.httpApi.resources.push({
    ...application.httpApi.resources[0],
    id: 'secondary-api',
    path: '/secondary',
    entityId: 'secondary'
  })
  return application
}

function normalized(application: BackendApplicationSpecV1) {
  const result = parseBackendApplicationSpecV1(application)
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
  if (!result.ok) throw new Error('The namespace fixture must remain valid shared Backend IR')
  return result.value
}

function plan(application: BackendApplicationSpecV1) {
  return createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
    selection: SELECTION,
    application,
    target: 'react',
    mode: 'production'
  })
}

function emit(source: BackendProviderPlan) {
  return emitBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
    selection: SELECTION,
    plan: source
  })
}

describe('NestJS PostgreSQL relation namespace', () => {
  test.each([
    ['notes_pkey', false],
    ['notes_pkey', true],
    ['notes_owner_page_idx', false],
    ['notes_owner_page_idx', true]
  ] as const)('rejects generated-index table %s with reversed entities %s', (name, reverse) => {
    const application = reverse ? twoEntities('notes', name) : twoEntities(name)
    if (reverse) application.dataModel.entities.reverse()
    const result = plan(normalized(application))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'backend-nestjs-unsupported',
        path: '$.application.dataModel.entities',
        message: expect.stringContaining('relation names')
      })
    )
  })

  test.each([
    ['notes', 'archives'],
    ['a'.repeat(48), 'b'.repeat(48)]
  ])('retains valid fresh schema for %s and %s', (first, second) => {
    const result = plan(normalized(twoEntities(second, first)))
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    if (!result.ok) throw new Error('Expected distinct PostgreSQL relation names')
    const emitted = emit(result.plan)
    expect(emitted.ok, JSON.stringify(emitted.ok ? [] : emitted.diagnostics)).toBe(true)
    if (!emitted.ok) throw new Error('Expected valid multi-entity source artifacts')
    const sql = emitted.emission.files.get('backend/nestjs/migrations/001-initial.sql')
    if (typeof sql !== 'string') throw new Error('Expected emitted migration text')
    for (const name of [first, second]) {
      expect(sql).toContain('CREATE TABLE "public"."' + name + '"')
      expect(sql).toContain('CREATE INDEX "' + name + '_owner_page_idx"')
      expect(new TextEncoder().encode(name + '_owner_page_idx').byteLength).toBeLessThanOrEqual(63)
    }
  })

  test.each(['notes_pkey', 'notes_owner_page_idx'])(
    'revalidates %s during emission after plan digests are recomputed',
    async (name) => {
      const result = plan(normalized(twoEntities('archives')))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected initial valid plan')
      const application = normalized(twoEntities(name))
      const modified: BackendProviderPlan = {
        ...result.plan,
        application,
        applicationDigest: await digestBackendApplication(application)
      }
      const emitted = emit({ ...modified, planDigest: backendProviderPlanDigest(modified) })
      expect(emitted.ok).toBe(false)
      if (emitted.ok) throw new Error('A recomputed digest cannot bypass schema validation')
      expect(emitted.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'backend-nestjs-unsupported',
          message: expect.stringContaining('relation names')
        })
      )
    }
  )
})
