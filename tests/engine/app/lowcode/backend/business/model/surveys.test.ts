import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { createSurveysApplication } from '@/app/lowcode/backend/business/model/surveys/application'
import { SURVEY_QUESTION_FIELDS } from '@/app/lowcode/backend/business/model/surveys/fields'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'surveys-test',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createSurveysApplication('surveys-contract', authentication)
function command(app: BackendApplicationSpecV1, id: string) {
  const found = app.commands?.commands.find((entry) => entry.id === id)
  if (!found) throw new Error('Missing survey command')
  return found
}
function policies(app: BackendApplicationSpecV1, resourceId: string) {
  const resource = app.httpApi?.resources.find((entry) => entry.id === resourceId)
  if (!resource) throw new Error('Missing survey resource')
  return app.auth.rowAccess.filter((policy) => resource.readPolicyIds?.includes(policy.id))
}

describe('versioned fixed-question survey model', () => {
  test('validates bounded ordinary commands and only read resources', () => {
    const app = application()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(app.dataModel.entities).toHaveLength(4)
    expect(app.commands?.commands).toHaveLength(6)
    expect(app.httpApi?.resources).toHaveLength(6)
    expect(app.auth.roles.map((role) => role.id)).toEqual(['survey-manager'])
    expect(app.httpApi?.browserClient?.authentication).toEqual(authentication)
    for (const entry of app.commands?.commands ?? []) {
      expect(entry.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(entry.steps.length).toBeGreaterThan(0)
      expect(entry.steps.length).toBeLessThanOrEqual(32)
      expect(entry.commerceOperation).toBeUndefined()
      expect(entry.foodOrderingOperation).toBeUndefined()
      expect(entry.parameters.map((parameter) => parameter.name)).not.toContain('ownerId')
      expect(entry.parameters.map((parameter) => parameter.name)).not.toContain('publicationNumber')
    }
    for (const resource of app.httpApi?.resources ?? []) {
      expect(resource.operations).toEqual(['list', 'read'])
      expect(resource.readFields).not.toContain('owner_id')
    }
  })

  test('publishes from a locked draft with server numbering and immutable question snapshots', () => {
    const app = application()
    const publish = command(app, 'publish-survey-version')
    expect(publish.access).toEqual({ kind: 'role', roleId: 'survey-manager' })
    expect(publish.parameters.map((parameter) => parameter.name)).toEqual(['draftId'])
    expect(publish.steps[0]).toMatchObject({
      kind: 'data.read',
      entityId: 'business-survey-drafts',
      resultName: 'draft',
      lock: 'update'
    })
    for (const field of SURVEY_QUESTION_FIELDS.filter((field) => field !== 'description'))
      expect(publish.steps).toContainEqual(
        expect.objectContaining({
          id: `required_${field}`,
          kind: 'assert',
          operator: 'neq',
          right: { kind: 'literal', value: '' }
        })
      )
    const insert = publish.steps.find((step) => step.id === 'published')
    expect(insert).toMatchObject({
      kind: 'data.mutate',
      operation: 'insert',
      values: expect.arrayContaining([
        {
          field: 'publication_number',
          value: { kind: 'result', name: 'numbered', field: 'publication_count' }
        },
        { field: 'owner_id', value: { kind: 'result', name: 'draft', field: 'owner_id' } },
        ...SURVEY_QUESTION_FIELDS.map((field) => ({
          field,
          value: { kind: 'result', name: 'draft', field }
        }))
      ])
    })
    const versionWrites = app.commands?.commands
      .flatMap((entry) => entry.steps)
      .filter(
        (step) =>
          step.kind === 'data.mutate' &&
          step.operation === 'update' &&
          step.entityId === 'business-survey-versions'
      )
    expect(versionWrites).toHaveLength(1)
    expect(versionWrites?.[0]).toMatchObject({
      values: [{ field: 'accepting', value: { kind: 'literal', value: false } }]
    })
    expect(
      command(app, 'update-survey-draft')
        .steps.filter((step) => step.kind === 'data.mutate')
        .map((step) => step.entityId)
    ).toEqual(['business-survey-drafts'])
    expect(
      app.dataModel.entities.find((entry) => entry.name === 'survey_versions')?.uniques
    ).toContainEqual({ id: 'one-publication-number', fields: ['draft_id', 'publication_number'] })
  })

  test('closes and submits under the same version lock and requires current acceptance before replay', () => {
    const app = application()
    const submit = command(app, 'submit-survey-response')
    expect(submit.access).toEqual({
      kind: 'row-policy',
      entityId: 'business-survey-versions',
      parameter: 'versionId',
      policyIds: ['accepting-survey-versions']
    })
    expect(
      app.auth.rowAccess.find((policy) => policy.id === 'accepting-survey-versions')
    ).toMatchObject({ conditions: [{ fieldId: 'accepting', value: true }] })
    for (const id of ['close-survey-version', 'submit-survey-response']) {
      const operation = command(app, id)
      expect(operation.steps[0]).toMatchObject({
        kind: 'data.read',
        entityId: 'business-survey-versions',
        resultName: 'published',
        key: { kind: 'parameter', name: 'versionId' },
        lock: 'update'
      })
      expect(operation.steps[1]).toMatchObject({
        id: 'accepting_responses',
        kind: 'assert',
        right: { kind: 'literal', value: true }
      })
    }
    expect(command(app, 'close-survey-version').access).toEqual({
      kind: 'role',
      roleId: 'survey-manager'
    })
    expect(submit.parameters).toEqual([
      { name: 'versionId', type: 'uuid', required: true },
      { name: 'rating', type: 'integer', required: true, min: 1, max: 5 },
      { name: 'choice', type: 'integer', required: true, min: 1, max: 3 },
      { name: 'comment', type: 'string', required: true, maxLength: 2000 }
    ])
  })

  test('binds one final response to the current caller and an existing published version', () => {
    const app = application()
    const responses = app.dataModel.entities.find((entry) => entry.name === 'survey_responses')
    expect(responses?.uniques).toContainEqual({
      id: 'one-response-per-account-version',
      fields: ['owner_id', 'version_id']
    })
    expect(responses?.foreignKeys).toContainEqual({
      id: 'published-version',
      fields: ['version_id'],
      targetEntityId: 'business-survey-versions',
      targetFields: ['id'],
      onDelete: 'restrict'
    })
    const writes = app.commands?.commands
      .flatMap((entry) => entry.steps)
      .filter((step) => step.kind === 'data.mutate' && step.entityId === responses?.id)
    expect(writes).toHaveLength(1)
    expect(structuredClone(writes?.[0])).toMatchObject({
      operation: 'insert',
      values: expect.arrayContaining([
        { field: 'owner_id', value: { kind: 'caller-sub' } },
        { field: 'version_id', value: { kind: 'result', name: 'published', field: 'id' } },
        { field: 'survey_title', value: { kind: 'result', name: 'published', field: 'title' } }
      ])
    })
    const forged = command(app, 'submit-survey-response').steps.find(
      (step) => step.id === 'response'
    )
    if (forged?.kind !== 'data.mutate') throw new Error('Missing response insertion')
    const owner = forged.values.find((value) => value.field === 'owner_id')
    if (!owner) throw new Error('Missing response owner')
    owner.value = { kind: 'parameter', name: 'versionId' }
    expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
  })

  test('keeps drafts and all answer projections private while published questions stay readable', () => {
    const app = application()
    expect(policies(app, 'survey-versions').map((policy) => policy.principal)).toEqual([
      { kind: 'anonymous' }
    ])
    expect(policies(app, 'survey-drafts').map((policy) => policy.principal)).toEqual([
      { kind: 'role', roleId: 'survey-manager' }
    ])
    expect(policies(app, 'survey-responses').map((policy) => policy.principal.kind)).toEqual([
      'owner'
    ])
    expect(policies(app, 'survey-management-responses').map((policy) => policy.principal)).toEqual([
      { kind: 'role', roleId: 'survey-manager' }
    ])
    expect(
      app.auth.rowAccess
        .filter((policy) => policy.entityId === 'business-survey-responses')
        .some((policy) => policy.principal.kind === 'anonymous')
    ).toBe(false)
    const versions = app.httpApi?.resources.find((entry) => entry.id === 'survey-versions')
    expect(versions?.readFields).not.toContain('comment')
    expect(versions?.query?.filterFields).toEqual(['id', 'draft_id', 'accepting'])
  })

  test('emits trusted NestJS schema constraints, command plans and private response services', () => {
    const files = modelFiles(application())
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(sql).toContain('UNIQUE ("owner_id", "version_id")')
    expect(sql).toContain('UNIQUE ("draft_id", "publication_number")')
    expect(sql).toContain('FOREIGN KEY ("version_id")')
    expect(files.get('backend/nestjs/src/command-plans.ts')).toContain('submit-survey-response')
    expect(files.get('backend/nestjs/src/resources/survey-responses.service.ts')).toContain(
      'owner_id'
    )
    expect(
      files.get('backend/nestjs/src/resources/survey-management-responses.service.ts')
    ).toContain('survey-manager')
  })
})
