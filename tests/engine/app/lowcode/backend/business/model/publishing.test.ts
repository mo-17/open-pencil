import { describe, expect, test } from 'bun:test'

import { planNestJSLocalPreviewMigration } from '@open-pencil/compiler/backend'
import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import { createAutomotiveApplication } from '@/app/lowcode/backend/business/model/automotive/application'
import { createBlogApplication } from '@/app/lowcode/backend/business/model/blog/application'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'publishing-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const variants = [
  {
    prefix: 'blog',
    factory: createBlogApplication,
    role: 'blog-author',
    entities: 5,
    commands: 10,
    resources: 8
  },
  {
    prefix: 'auto',
    factory: createAutomotiveApplication,
    role: 'auto-editor',
    entities: 7,
    commands: 14,
    resources: 12
  }
] as const

function command(app: BackendApplicationSpecV1, id: string) {
  const found = app.commands?.commands.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing publishing command: ' + id)
  return found
}
function resource(app: BackendApplicationSpecV1, id: string) {
  const found = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing publishing resource: ' + id)
  return found
}
function entity(app: BackendApplicationSpecV1, name: string) {
  const found = app.dataModel.entities.find((entry) => entry.name === name)
  if (!found) throw new Error('Missing publishing entity: ' + name)
  return found
}
function policies(app: BackendApplicationSpecV1, id: string) {
  return app.auth.rowAccess.filter((policy) => resource(app, id).readPolicyIds?.includes(policy.id))
}

for (const variant of variants) {
  const { prefix, role } = variant
  const application = () => variant.factory('publishing-contract', authentication)
  describe(`${prefix} publishing model`, () => {
    test('uses only bounded ordinary commands and preserves public OIDC configuration', () => {
      const app = application()
      const parsed = parseBackendApplicationSpecV1(app)
      expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
      expect(parsed.diagnostics).toEqual([])
      expect(app.dataModel.entities).toHaveLength(variant.entities)
      expect(app.commands?.commands).toHaveLength(variant.commands)
      expect(app.httpApi?.resources).toHaveLength(variant.resources)
      expect(app.commerce).toBeUndefined()
      expect(app.foodOrdering).toBeUndefined()
      for (const operation of app.commands?.commands ?? []) {
        expect(operation.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
        expect(operation.steps.length).toBeGreaterThan(0)
        expect(operation.steps.length).toBeLessThanOrEqual(32)
        expect(operation.commerceOperation).toBeUndefined()
        expect(operation.foodOrderingOperation).toBeUndefined()
        expect(
          operation.parameters.some((parameter) =>
            /^(role|ownerId|status|version|publishedAt)$/.test(parameter.name)
          )
        ).toBe(false)
      }
      for (const projection of app.httpApi?.resources ?? []) {
        expect(projection.operations).toEqual(['list', 'read'])
        expect(projection.readFields).not.toContain('owner_id')
      }
      expect(
        command(app, 'register-business-user').parameters.map((parameter) => parameter.name)
      ).toEqual(['title'])
      expect(app.httpApi?.browserClient?.authentication).toEqual(authentication)
    })

    test('isolates drafts and leaves bookmarks content-free with current-publication lookup by id', () => {
      const app = application()
      expect(policies(app, `${prefix}-articles`)).toMatchObject([
        {
          principal: { kind: 'anonymous' },
          conditions: [{ fieldId: 'status', value: 'published' }]
        }
      ])
      expect(resource(app, `${prefix}-articles`).query?.filterFields).toContain('id')
      expect(policies(app, `${prefix}-categories`)).toMatchObject([
        { principal: { kind: 'anonymous' }, conditions: [{ fieldId: 'active', value: true }] }
      ])
      expect(policies(app, `${prefix}-bookmarks`).map((entry) => entry.principal.kind)).toEqual([
        'owner'
      ])
      expect(resource(app, `${prefix}-bookmarks`).readFields).toEqual([
        'id',
        'article_id',
        'active',
        'version',
        'created_at'
      ])
      expect(entity(app, `${prefix}_bookmarks`).fields.map((field) => field.id)).toEqual([
        'id',
        'owner_id',
        'article_id',
        'active',
        'version',
        'created_at'
      ])
      expect(entity(app, `${prefix}_bookmarks`).uniques).toContainEqual({
        id: 'one-bookmark-per-reader',
        fields: ['owner_id', 'article_id']
      })
      expect(entity(app, `${prefix}_article_history`).foreignKeys).toContainEqual(
        expect.objectContaining({
          fields: ['article_id', 'owner_id'],
          targetEntityId: `business-${prefix}-articles`,
          targetFields: ['id', 'owner_id'],
          onDelete: 'restrict'
        })
      )
    })

    test('requires the current author role plus owner authority to edit and requires withdrawal first', () => {
      const app = application()
      expect(command(app, `create-${prefix}-article`).access).toEqual({
        kind: 'role',
        roleId: role
      })
      const edit = command(app, `update-${prefix}-article`)
      expect(edit.access).toEqual({
        kind: 'row-policy',
        entityId: `business-${prefix}-articles`,
        parameter: 'articleId',
        policyIds: [`own-${prefix}-articles`],
        roleId: role
      })
      expect(edit.steps.find((step) => step.id === 'expected_status')).toMatchObject({
        kind: 'assert',
        operator: 'eq',
        right: { kind: 'literal', value: 'draft' }
      })
      expect(edit.steps[0]).toMatchObject({
        kind: 'data.read',
        resultName: 'article',
        lock: 'update'
      })
      expect(edit.steps.at(-1)).toMatchObject({
        kind: 'data.mutate',
        operation: 'insert',
        entityId: `business-${prefix}-article-history`
      })
      const publish = command(app, `publish-${prefix}-article`)
      expect(publish.access).toMatchObject({
        roleId: prefix === 'auto' ? 'auto-publisher' : 'blog-author',
        policyIds: [prefix === 'auto' ? 'auto-article-publisher' : 'own-blog-articles']
      })
      const withdraw = command(app, `unpublish-${prefix}-article`)
      expect(withdraw.steps.find((step) => step.id === 'expected_status')).toMatchObject({
        right: { kind: 'literal', value: 'published' }
      })
      expect(
        withdraw.steps.filter((step) => step.kind === 'data.read').map((step) => step.resultName)
      ).toEqual(['article'])
      expect(withdraw.steps.find((step) => step.id === 'updated')).toMatchObject({
        values: expect.arrayContaining([
          { field: 'status', value: { kind: 'literal', value: 'draft' } },
          { field: 'published_at', value: { kind: 'literal', value: null } }
        ])
      })
      const management = policies(app, `${prefix}-management-articles`).map(
        (entry) => entry.principal
      )
      expect(management).toEqual([
        { kind: 'owner', ownershipId: `own-${prefix}-articles` },
        ...(prefix === 'auto' ? [{ kind: 'role', roleId: 'auto-publisher' }] : [])
      ])
    })

    test('publishes only after locked active catalog checks and records server time plus immutable audit ownership', () => {
      const app = application()
      const publish = command(app, `publish-${prefix}-article`)
      const reads = publish.steps.filter((step) => step.kind === 'data.read')
      expect(reads.map((step) => step.resultName)).toEqual([
        'article',
        'category',
        ...(prefix === 'auto' ? ['model', 'brand'] : [])
      ])
      expect(reads.every((step) => step.lock === 'update')).toBe(true)
      for (const id of [
        'active_category',
        'nonempty_title',
        'nonempty_body',
        ...(prefix === 'auto' ? ['active_model', 'active_brand'] : [])
      ])
        expect(publish.steps.some((step) => step.kind === 'assert' && step.id === id)).toBe(true)
      expect(publish.steps.find((step) => step.id === 'updated')).toMatchObject({
        values: expect.arrayContaining([{ field: 'published_at', value: { kind: 'server-now' } }])
      })
      expect(publish.steps.at(-1)).toMatchObject({
        values: expect.arrayContaining([
          { field: 'owner_id', value: { kind: 'result', name: 'article', field: 'owner_id' } },
          { field: 'actor_subject', value: { kind: 'caller-sub' } }
        ])
      })
      expect(command(app, `create-${prefix}-article`).parameters).toContainEqual({
        name: 'body',
        type: 'string',
        required: true,
        maxLength: 8192
      })
    })

    test('cancels without private article reads and restores the existing bookmark under publication and owner checks', () => {
      const app = application()
      const cancel = command(app, `cancel-${prefix}-bookmark`)
      expect(cancel.access).toMatchObject({ policyIds: [`own-${prefix}-bookmarks`] })
      expect(
        cancel.steps.filter((step) => step.kind === 'data.read').map((step) => step.entityId)
      ).toEqual([`business-${prefix}-bookmarks`])
      const restore = command(app, `restore-${prefix}-bookmark`)
      expect(restore.access).toMatchObject({ policyIds: [`${prefix}-published-articles`] })
      const reads = restore.steps.filter((step) => step.kind === 'data.read')
      expect(reads.map((step) => step.resultName)).toEqual(['article', 'bookmark'])
      expect(reads[1]).toMatchObject({ scope: 'owner', lock: 'update' })
      expect(restore.steps.find((step) => step.id === 'bookmark_article_matches')).toMatchObject({
        left: { kind: 'result', name: 'bookmark', field: 'article_id' },
        right: { kind: 'result', name: 'article', field: 'id' }
      })
      expect(
        restore.steps.some((step) => step.kind === 'data.mutate' && step.operation === 'insert')
      ).toBe(false)
      expect(command(app, `create-${prefix}-bookmark`).return.fields).not.toContain('body')
    })

    test('rejects client-supplied article ownership before provider emission', () => {
      const app = application()
      const insert = command(app, `create-${prefix}-article`).steps.find(
        (step) => step.id === 'article'
      )
      if (insert?.kind !== 'data.mutate') throw new Error('Missing article insertion')
      const owner = insert.values.find((value) => value.field === 'owner_id')
      if (!owner) throw new Error('Missing article owner')
      owner.value = { kind: 'parameter', name: 'categoryId' }
      expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
    })

    test('emits real NestJS SQL and ordinary command plans with conditional public reads', () => {
      const files = modelFiles(application())
      const sql = files.get('backend/nestjs/migrations/001-initial.sql')
      expect(sql).toContain(`"${prefix}_articles"`)
      expect(sql).toContain('UNIQUE ("owner_id", "article_id")')
      expect(sql).toContain('FOREIGN KEY ("article_id", "owner_id")')
      expect(files.get('backend/nestjs/src/command-plans.ts')).toContain(
        `publish-${prefix}-article`
      )
      const published = files.get(`backend/nestjs/src/resources/${prefix}-articles.service.ts`)
      expect(published).toContain('published')
      expect(published).toContain('status')
      expect(files.get(`backend/nestjs/src/resources/${prefix}-bookmarks.service.ts`)).toContain(
        'owner_id'
      )
      expect(files.has('backend/nestjs/src/publishing-execution.ts')).toBe(false)
    })
  })
}

test('blog and automotive compose with CRM without reassigning its resources or widening ownership', async () => {
  const from = createBusinessApplication('publishing-composite', authentication, 'customer-crm')
  const baseline = structuredClone(from)
  const to = composeBusinessModules(from, ['customer-crm', 'personal-blog', 'automotive-news'], {
    adoptExisting: ['customer-crm']
  }).application
  expect(from).toEqual(baseline)
  expect(parseBackendApplicationSpecV1(to).diagnostics).toEqual([])
  for (const entry of baseline.auth.rowAccess)
    expect(to.auth.rowAccess.find((policy) => policy.id === entry.id)).toEqual(entry)
  for (const entry of baseline.commands?.commands ?? [])
    expect(command(to, entry.id)).toEqual(entry)
  for (const entry of baseline.httpApi?.resources ?? [])
    expect(resource(to, entry.id)).toEqual(entry)
  for (const [id, entities, commands] of [
    ['personal-blog', 4, 9],
    ['automotive-news', 6, 13]
  ] as const) {
    const module = to.modules?.modules.find((entry) => entry.id === id)
    expect(module?.entityIds).toHaveLength(entities)
    expect(module?.commandIds).toHaveLength(commands)
    expect(module?.dependsOn).toEqual(['shared-accounts'])
  }
  expect(to.dataModel.entities.filter((entry) => entry.name === 'users')).toHaveLength(1)
  const migration = await planNestJSLocalPreviewMigration({
    fromApplication: from,
    toApplication: to
  })
  expect(migration.ok, migration.ok ? undefined : JSON.stringify(migration.diagnostics)).toBe(true)
  if (!migration.ok) throw new Error('Publishing addition was not additive')
  expect(migration.plan.sql).toContain('CREATE TABLE "public"."blog_articles"')
  expect(migration.plan.sql).toContain('CREATE TABLE "public"."auto_articles"')
  expect(migration.plan.sql).not.toContain('ALTER TABLE "public"."customers"')
  expect(migration.plan.sql).not.toContain('ALTER TABLE "public"."users"')
  expect(
    modelFiles(to).get('backend/nestjs/src/modules/automotive-news/command-plans.ts')
  ).toContain('create-auto-bookmark')
})
