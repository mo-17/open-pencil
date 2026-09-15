import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { createCommunityApplication } from '@/app/lowcode/backend/business/model/community/application'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'community-test',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createCommunityApplication('community-contract', authentication)
function command(app: BackendApplicationSpecV1, id: string) {
  const found = app.commands?.commands.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing community command')
  return found
}
function resource(app: BackendApplicationSpecV1, id: string) {
  const found = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing community resource')
  return found
}
function policies(app: BackendApplicationSpecV1, id: string) {
  return app.auth.rowAccess.filter((policy) => resource(app, id).readPolicyIds?.includes(policy.id))
}

describe('moderated community model', () => {
  test('validates bounded ordinary commands without anonymous writes or direct resource mutation', () => {
    const app = application()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(app.dataModel.entities).toHaveLength(5)
    expect(app.commands?.commands).toHaveLength(15)
    expect(app.httpApi?.resources).toHaveLength(11)
    expect(app.auth.roles.map((role) => role.id)).toEqual(['community-moderator'])
    for (const entry of app.commands?.commands ?? []) {
      expect(entry.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(entry.steps.length).toBeGreaterThan(0)
      expect(entry.steps.length).toBeLessThanOrEqual(32)
      expect(entry.commerceOperation).toBeUndefined()
      expect(entry.foodOrderingOperation).toBeUndefined()
      expect(
        entry.parameters.some((parameter) =>
          /^(ownerId|status|resolvedBy|resolvedAt)$/.test(parameter.name)
        )
      ).toBe(false)
    }
    expect(command(app, 'create-community-post').access).toEqual({ kind: 'authenticated' })
    for (const entry of app.httpApi?.resources ?? []) {
      expect(entry.operations).toEqual(['list', 'read'])
      expect(entry.readFields).not.toContain('owner_id')
    }
  })

  test('publishes only approved posts and replies and excludes moderation and report text from public reads', () => {
    const app = application()
    expect(policies(app, 'community-posts')).toMatchObject([
      { principal: { kind: 'anonymous' }, conditions: [{ fieldId: 'status', value: 'published' }] },
      { principal: { kind: 'anonymous' }, conditions: [{ fieldId: 'status', value: 'closed' }] }
    ])
    expect(policies(app, 'community-replies')).toMatchObject([
      { principal: { kind: 'anonymous' }, conditions: [{ fieldId: 'status', value: 'published' }] }
    ])
    for (const id of ['community-posts', 'community-replies']) {
      expect(resource(app, id).readFields).not.toContain('moderation_note')
      expect(resource(app, id).readFields).not.toContain('reason')
      expect(resource(app, id).readFields).not.toContain('resolution')
    }
    for (const domain of ['posts', 'replies', 'reports']) {
      expect(
        policies(app, `community-my-${domain}`).map((policy) => policy.principal.kind)
      ).toEqual(['owner'])
      expect(
        policies(app, `community-management-${domain}`).map((policy) => policy.principal)
      ).toEqual([{ kind: 'role', roleId: 'community-moderator' }])
    }
    expect(resource(app, 'community-my-replies').readFields).toContain('moderation_note')
  })

  test('prevents editing or withdrawing public posts and closing never mutates child replies', () => {
    const app = application()
    const edit = command(app, 'update-community-post')
    expect(edit.access).toMatchObject({ kind: 'row-policy', policyIds: ['own-community-posts'] })
    for (const status of ['published', 'closed'])
      expect(edit.steps).toContainEqual(
        expect.objectContaining({
          id: `not_${status}`,
          kind: 'assert',
          operator: 'neq',
          right: { kind: 'literal', value: status }
        })
      )
    for (const [id, from] of [
      ['publish-community-post', 'pending'],
      ['reject-community-post', 'pending'],
      ['close-community-post', 'published']
    ]) {
      const entry = command(app, id)
      expect(entry.access).toEqual({ kind: 'role', roleId: 'community-moderator' })
      expect(entry.steps).toContainEqual(
        expect.objectContaining({
          id: 'expected_post_status',
          right: { kind: 'literal', value: from }
        })
      )
    }
    const close = command(app, 'close-community-post')
    expect(
      close.steps.filter((step) => step.kind === 'data.mutate').map((step) => step.entityId)
    ).toEqual(['business-community-posts'])
    expect(app.commands?.commands.some((entry) => /delete|unpublish/.test(entry.id))).toBe(false)
  })

  test('checks the reviewed content version under lock for author edits and moderator decisions', () => {
    const app = application()
    for (const id of [
      'update-community-post',
      'publish-community-post',
      'reject-community-post',
      'close-community-post',
      'update-community-reply',
      'publish-community-reply',
      'remove-community-reply'
    ]) {
      const entry = command(app, id)
      const record = id.endsWith('reply') ? 'reply' : 'post'
      expect(entry.parameters).toContainEqual({
        name: 'expectedVersion',
        type: 'integer',
        required: true,
        min: 0,
        max: 2147483646
      })
      expect(entry.steps).toContainEqual(
        expect.objectContaining({
          id: 'unchanged_content',
          kind: 'assert',
          left: { kind: 'result', name: record, field: 'version' },
          right: { kind: 'parameter', name: 'expectedVersion' }
        })
      )
      const update = entry.steps.find(
        (step) => step.kind === 'data.mutate' && step.operation === 'update'
      )
      expect(update).toMatchObject({
        values: expect.arrayContaining([
          {
            field: 'version',
            value: {
              kind: 'integer-arithmetic',
              operator: 'add',
              left: { kind: 'result', name: record, field: 'version' },
              right: { kind: 'literal', value: 1 }
            }
          }
        ])
      })
    }
  })

  test('uses post-before-reply locks and validates ownership, parent identity and open discussion', () => {
    const app = application()
    for (const id of ['create-community-reply', 'update-community-reply']) {
      const entry = command(app, id)
      expect(entry.access).toEqual({
        kind: 'row-policy',
        entityId: 'business-community-posts',
        parameter: 'postId',
        policyIds: ['community-posts-published']
      })
      expect(entry.steps).toContainEqual(
        expect.objectContaining({
          id: 'expected_post_status',
          right: { kind: 'literal', value: 'published' }
        })
      )
    }
    for (const id of [
      'update-community-reply',
      'publish-community-reply',
      'remove-community-reply'
    ]) {
      const entry = command(app, id)
      const reads = entry.steps.filter((step) => step.kind === 'data.read')
      expect(reads.map((step) => step.resultName)).toEqual(['post', 'reply'])
      expect(reads.every((step) => step.lock === 'update')).toBe(true)
      expect(entry.steps).toContainEqual(
        expect.objectContaining({
          id: 'reply_post_matches',
          left: { kind: 'result', name: 'reply', field: 'post_id' },
          right: { kind: 'result', name: 'post', field: 'id' }
        })
      )
      if (id === 'update-community-reply') expect(reads[1].scope).toBe('owner')
      else expect(entry.access).toEqual({ kind: 'role', roleId: 'community-moderator' })
    }
    expect(command(app, 'create-community-reply').parameters).toContainEqual({
      name: 'body',
      type: 'string',
      required: true,
      maxLength: 4000
    })
  })

  test('stores private content-free unique follows and restores only the original matching record', () => {
    const app = application()
    const follows = app.dataModel.entities.find((entity) => entity.name === 'community_follows')
    expect(follows?.uniques).toContainEqual({
      id: 'one-follow-per-member-post',
      fields: ['owner_id', 'post_id']
    })
    expect(follows?.fields.map((field) => field.id)).toEqual([
      'id',
      'owner_id',
      'post_id',
      'active',
      'created_at'
    ])
    expect(policies(app, 'community-follows').map((policy) => policy.principal.kind)).toEqual([
      'owner'
    ])
    expect(
      command(app, 'cancel-community-follow')
        .steps.filter((step) => step.kind === 'data.read')
        .map((step) => step.entityId)
    ).toEqual(['business-community-follows'])
    const restore = command(app, 'restore-community-follow')
    expect(
      restore.steps.filter((step) => step.kind === 'data.read').map((step) => step.resultName)
    ).toEqual(['post', 'follow'])
    expect(restore.steps).toContainEqual(expect.objectContaining({ id: 'follow_post_matches' }))
    expect(
      restore.steps.some((step) => step.kind === 'data.mutate' && step.operation === 'insert')
    ).toBe(false)
  })

  test('records report handling on the server without exposing or automatically modifying reported content', () => {
    const app = application()
    const resolve = command(app, 'resolve-community-report')
    expect(resolve.access).toEqual({ kind: 'role', roleId: 'community-moderator' })
    expect(
      resolve.steps.filter((step) => step.kind === 'data.mutate').map((step) => step.entityId)
    ).toEqual(['business-community-reports'])
    expect(resolve.steps.at(-1)).toMatchObject({
      values: expect.arrayContaining([
        { field: 'resolved_by', value: { kind: 'caller-sub' } },
        { field: 'resolved_at', value: { kind: 'server-now' } }
      ])
    })
    expect(
      command(app, 'create-community-report').parameters.map((parameter) => parameter.name)
    ).toEqual(['postId', 'reason'])
    const fresh = application()
    const insertion = command(fresh, 'create-community-report').steps.find(
      (step) => step.kind === 'data.mutate'
    )
    if (insertion?.kind !== 'data.mutate') throw new Error('Missing report insertion')
    const owner = insertion.values.find((value) => value.field === 'owner_id')
    if (!owner) throw new Error('Missing report owner')
    owner.value = { kind: 'parameter', name: 'postId' }
    expect(parseBackendApplicationSpecV1(fresh).ok).toBe(false)
  })

  test('emits trusted NestJS plans and conditional resources without broadening cross-owner references', () => {
    const files = modelFiles(application())
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(sql).toContain('UNIQUE ("owner_id", "post_id")')
    expect(files.get('backend/nestjs/src/command-plans.ts')).toContain('expectedVersion')
    expect(files.get('backend/nestjs/src/resources/community-posts.service.ts')).not.toContain(
      'moderation_note'
    )
    expect(files.get('backend/nestjs/src/resources/community-replies.service.ts')).not.toContain(
      'moderation_note'
    )
    expect(files.get('backend/nestjs/src/resources/community-my-reports.service.ts')).toContain(
      'owner_id'
    )
    expect(
      files.get('backend/nestjs/src/resources/community-management-reports.service.ts')
    ).toContain('community-moderator')
  })
})
