import { describe, expect, test } from 'bun:test'

import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  createBuiltinBackendProviderRegistry,
  createBackendProviderPlan,
  emitBackendProviderPlan
} from '@open-pencil/compiler/backend'
import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createMediaApplication } from '@/app/lowcode/backend/business/model/media/application'
import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'media-public-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createMediaApplication('media-contract', authentication)

function command(app: BackendApplicationSpecV1, id: string) {
  const result = app.commands?.commands.find((entry) => entry.id === id)
  if (!result) throw new Error('Missing media command: ' + id)
  return result
}
function resource(app: BackendApplicationSpecV1, id: string) {
  const result = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!result) throw new Error('Missing media resource: ' + id)
  return result
}
function policies(app: BackendApplicationSpecV1, id: string) {
  const selected = resource(app, id).readPolicyIds
  return app.auth.rowAccess.filter((entry) => selected?.includes(entry.id))
}
function assertion(app: BackendApplicationSpecV1, id: string, name: string) {
  const result = command(app, id).steps.find((step) => step.id === name)
  if (result?.kind !== 'assert') throw new Error('Missing media assertion: ' + name)
  return result
}

function emittedFiles(app: BackendApplicationSpecV1) {
  const registry = createBuiltinBackendProviderRegistry()
  const selection = {
    descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest: 'sha256:' + 'A'.repeat(43),
    enabled: true
  }
  const planned = createBackendProviderPlan(registry, {
    application: app,
    selection,
    target: 'vue',
    mode: 'production'
  })
  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
  if (!planned.ok) throw new Error('Media provider plan failed')
  const emitted = emitBackendProviderPlan(registry, { selection, plan: planned.plan })
  expect(emitted.ok).toBe(true)
  if (!emitted.ok) throw new Error('Media provider emission failed')
  return emitted.emission.files
}

describe('video and live-channel business model', () => {
  test('normalizes a command-only application without streaming credentials or client-assigned authority', () => {
    const app = application()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(app.dataModel.entities).toHaveLength(6)
    expect(app.commands?.commands).toHaveLength(16)
    expect(app.httpApi?.resources).toHaveLength(9)
    expect(app.auth.roles.map((role) => role.id)).toEqual(['media-creator', 'media-admin'])
    expect(app.commerce).toBeUndefined()
    for (const entry of app.httpApi?.resources ?? [])
      expect(entry.operations).toEqual(['list', 'read'])
    for (const entry of app.commands?.commands ?? []) {
      expect(entry.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(entry.steps.length).toBeLessThanOrEqual(32)
      expect(
        entry.parameters.some((parameter) =>
          /^(owner_?id|role|status|version|active|stream.?key|ingest.?key)$/i.test(parameter.name)
        )
      ).toBe(false)
    }
    expect(
      app.dataModel.entities
        .flatMap((entity) => entity.fields.map((field) => field.id))
        .some((id) => /secret|token|stream.?key|ingest/i.test(id))
    ).toBe(false)
    const auth = app.httpApi?.browserClient?.authentication
    if (!auth) throw new Error('Missing media authentication')
    auth.scopes.push('email')
    expect(authentication.scopes).toEqual(['openid', 'profile'])
  })

  test('public catalogs cannot inherit owner/admin visibility into drafts or archives', () => {
    const app = application()
    const videos = policies(app, 'media-videos')
    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({
      principal: { kind: 'anonymous' },
      conditions: [{ fieldId: 'status', value: 'published' }]
    })
    const channels = policies(app, 'media-channels')
    expect(channels).toHaveLength(3)
    expect(channels.map((policy) => policy.conditions?.[0]?.value).sort()).toEqual([
      'ended',
      'live',
      'scheduled'
    ])
    for (const policy of channels) expect(policy.principal).toEqual({ kind: 'anonymous' })
    for (const id of ['media-videos', 'media-channels']) {
      expect(resource(app, id).readFields).toContain('playback_url')
      expect(resource(app, id).readFields).toContain('poster_url')
      expect(resource(app, id).readFields).not.toContain('owner_id')
      expect(
        policies(app, id).every((policy) =>
          policy.operations.every((operation) => operation === 'select')
        )
      ).toBe(true)
    }
  })

  test('management and history require ownership or admin, while profile registration cannot grant creator roles', () => {
    const app = application()
    for (const kind of ['video', 'channel']) {
      for (const id of [`media-management-${kind}s`, `media-${kind}-history`]) {
        expect(
          policies(app, id)
            .map((policy) => policy.principal.kind)
            .sort()
        ).toEqual(['owner', 'role'])
        expect(
          policies(app, id).find((policy) => policy.principal.kind === 'role')?.principal
        ).toEqual({ kind: 'role', roleId: 'media-admin' })
      }
      const create = command(app, `create-media-${kind}`)
      expect(create.access).toMatchObject({
        kind: 'row-policy',
        parameter: 'userId',
        policyIds: ['media-creator-own-profile', 'media-admin-own-profile']
      })
      expect(create.steps[0]).toMatchObject({
        kind: 'data.read',
        entityId: 'business-users',
        scope: 'owner',
        lock: 'update'
      })
      expect(assertion(app, create.id, 'active_creator_profile').right).toEqual({
        kind: 'literal',
        value: true
      })
    }
    for (const roleId of ['media-creator', 'media-admin']) {
      expect(
        app.auth.rowAccess.find((policy) => policy.id === roleId + '-own-profile')?.principal
      ).toEqual({ kind: 'role', roleId })
      expect(
        app.httpApi?.resources.some((entry) =>
          entry.readPolicyIds?.includes(roleId + '-own-profile')
        )
      ).toBe(false)
    }
    expect(
      command(app, 'register-business-user').parameters.map((parameter) => parameter.name)
    ).toEqual(['title'])
  })

  test('metadata and lifecycle mutations lock their authorized parent and append owner-bound history before updating', () => {
    const app = application()
    for (const kind of ['video', 'channel']) {
      const history = app.dataModel.entities.find(
        (entity) => entity.name === `media_${kind}_history`
      )
      expect(history?.foreignKeys).toContainEqual({
        id: `${kind}-id-owner`,
        fields: [`${kind}_id`, 'owner_id'],
        targetEntityId: `business-media-${kind}s`,
        targetFields: ['id', 'owner_id'],
        onDelete: 'restrict'
      })
      for (const entry of app.commands?.commands.filter(
        (candidate) => candidate.id.endsWith(`media-${kind}`) && !candidate.id.startsWith('create-')
      ) ?? []) {
        expect(entry.access).toMatchObject({
          kind: 'row-policy',
          entityId: `business-media-${kind}s`,
          parameter: `${kind}Id`,
          policyIds: [`own-media-${kind}s`, `media-${kind}-admin`]
        })
        expect(entry.steps[0]).toMatchObject({
          kind: 'data.read',
          entityId: `business-media-${kind}s`,
          scope: 'command',
          lock: 'update'
        })
        const historyIndex = entry.steps.findIndex(
          (step) => step.kind === 'data.mutate' && step.entityId === history?.id
        )
        const updateIndex = entry.steps.findIndex(
          (step) => step.kind === 'data.mutate' && step.operation === 'update'
        )
        expect(historyIndex).toBeGreaterThan(0)
        expect(updateIndex).toBeGreaterThan(historyIndex)
        const update = entry.steps[updateIndex]
        if (update?.kind !== 'data.mutate') throw new Error('Missing media update')
        expect(update.values).toContainEqual({
          field: 'version',
          value: {
            kind: 'integer-arithmetic',
            operator: 'add',
            left: { kind: 'result', name: 'media', field: 'version' },
            right: { kind: 'literal', value: 1 }
          }
        })
      }
    }
  })

  test('scheduled/live/ended states use validated server time and never start or stop a real stream', () => {
    const app = application()
    for (const [id, status] of [
      ['publish-media-video', 'draft'],
      ['schedule-media-channel', 'draft'],
      ['start-media-channel', 'scheduled'],
      ['end-media-channel', 'live']
    ] as const) {
      expect(assertion(app, id, 'eq_' + status).right).toEqual({ kind: 'literal', value: status })
    }
    expect(command(app, 'schedule-media-channel').parameters).toContainEqual({
      name: 'scheduledAt',
      type: 'datetime',
      required: true
    })
    expect(assertion(app, 'schedule-media-channel', 'future_schedule')).toMatchObject({
      operator: 'gte',
      left: { kind: 'parameter', name: 'scheduledAt' },
      right: { kind: 'server-now' }
    })
    expect(command(app, 'start-media-channel').name).toContain('no stream is started')
    for (const id of ['publish-media-video', 'start-media-channel'])
      expect(assertion(app, id, 'playback_configured')).toMatchObject({
        operator: 'neq',
        right: { kind: 'literal', value: '' }
      })
    expect(assertion(app, 'archive-media-channel', 'neq_live').operator).toBe('neq')
    const restore = command(app, 'restore-media-channel')
    expect(assertion(app, restore.id, 'eq_archived').operator).toBe('eq')
    const mutation = restore.steps.find(
      (step) => step.kind === 'data.mutate' && step.operation === 'update'
    )
    if (mutation?.kind !== 'data.mutate') throw new Error('Missing channel restoration')
    expect(mutation.values).toContainEqual({
      field: 'scheduled_at',
      value: { kind: 'literal', value: null }
    })
    expect(app.commands?.commands.every((entry) => !entry.commerceOperation)).toBe(true)
  })

  test('favorites are unique and private, and cannot expose archived playback URLs or restore another user/video pair', () => {
    const app = application()
    const entity = app.dataModel.entities.find((entry) => entry.name === 'media_favorites')
    expect(entity?.uniques).toContainEqual({
      id: 'one-favorite-per-viewer',
      fields: ['owner_id', 'video_id']
    })
    expect(entity?.foreignKeys ?? []).toHaveLength(0)
    expect(policies(app, 'media-favorites').map((policy) => policy.principal.kind)).toEqual([
      'owner'
    ])
    expect(resource(app, 'media-favorites').readFields).toEqual([
      'id',
      'video_id',
      'video_title',
      'active',
      'version',
      'created_at'
    ])
    const cancel = command(app, 'cancel-media-favorite')
    expect(
      cancel.steps.filter((step) => step.kind === 'data.read').map((step) => step.entityId)
    ).toEqual(['business-media-favorites'])
    for (const id of ['create-media-favorite', 'restore-media-favorite']) {
      expect(command(app, id).access).toMatchObject({
        kind: 'row-policy',
        policyIds: ['media-published-videos']
      })
      expect(assertion(app, id, 'eq_published').right).toEqual({
        kind: 'literal',
        value: 'published'
      })
      expect(command(app, id).return.fields.some((field) => field.endsWith('_url'))).toBe(false)
    }
    const restore = command(app, 'restore-media-favorite')
    expect(restore.steps.find((step) => step.id === 'favorite')).toMatchObject({
      kind: 'data.read',
      scope: 'owner',
      lock: 'update'
    })
    expect(assertion(app, restore.id, 'favorite_video_matches')).toMatchObject({
      left: { kind: 'result', name: 'favorite', field: 'video_id' },
      right: { kind: 'result', name: 'media', field: 'id' }
    })
    const firstWrite = restore.steps.findIndex((step) => step.kind === 'data.mutate')
    expect(restore.steps.findIndex((step) => step.id === 'favorite_video_matches')).toBeLessThan(
      firstWrite
    )
  })

  test('the trusted NestJS pg provider emits the full schema, resources and command plans', () => {
    const files = emittedFiles(application())
    const migration = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(migration).toContain('"media_videos"')
    expect(migration).toContain('"media_channels"')
    expect(migration).toContain('"scheduled_at" timestamp with time zone DEFAULT NULL')
    expect(migration).toContain('FOREIGN KEY ("video_id", "owner_id")')
    expect(migration).toContain('UNIQUE ("owner_id", "video_id")')
    expect(files.get('backend/nestjs/src/resources/media-videos.service.ts')).toContain('published')
    expect(files.get('backend/nestjs/src/resources/media-favorites.service.ts')).toContain(
      'owner_id'
    )
    expect(files.get('backend/nestjs/src/command-plans.ts')).toContain('restore-media-favorite')
    expect(files.get('backend/nestjs/package.json')).toContain('"pg"')
    expect(files.get('backend/nestjs/package.json')).not.toContain('@prisma')
  })

  test('video plus CRM preserves media policies and emits one shared account module', () => {
    const base = application()
    const before = structuredClone(base)
    const result = composeBusinessModules(base, ['video-live', 'customer-crm'], {
      adoptExisting: ['video-live']
    })
    expect(base).toEqual(before)
    expect(parseBackendApplicationSpecV1(result.application).diagnostics).toEqual([])
    expect(result.application.modules?.modules.map((entry) => entry.id)).toEqual([
      'shared-accounts',
      'video-live',
      'customer-crm'
    ])
    expect(resource(result.application, 'media-videos')).toEqual(resource(base, 'media-videos'))
    expect(command(result.application, 'restore-media-favorite')).toEqual(
      command(base, 'restore-media-favorite')
    )
    expect(
      emittedFiles(result.application).get(
        'backend/nestjs/src/modules/customer-crm/command-plans.ts'
      )
    ).toContain('assign-customer')
  })

  test('video plus commerce preserves commerce authority within the ordinary model budget', () => {
    const base = createCommerceOperationsApplication(
      'media-commerce',
      authentication,
      'multi-merchant'
    )
    const before = structuredClone(base)
    const result = composeBusinessModules(base, ['video-live'])
    expect(base).toEqual(before)
    expect(result.application.commerce).toEqual(base.commerce)
    expect(result.application.auth.tenants).toEqual(base.auth.tenants)
    expect(parseBackendApplicationSpecV1(result.application).diagnostics).toEqual([])
    for (const original of base.httpApi?.resources ?? [])
      expect(resource(result.application, original.id)).toEqual(original)
    for (const original of base.commands?.commands ?? [])
      expect(command(result.application, original.id)).toEqual(original)
    expect(
      emittedFiles(result.application).get('backend/nestjs/src/modules/video-live/command-plans.ts')
    ).toContain('restore-media-favorite')
  })
})
