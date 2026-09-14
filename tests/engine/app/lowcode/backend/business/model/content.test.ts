import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { createContentKnowledgeApplication } from '@/app/lowcode/backend/business/model/content/application'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'knowledge-test',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}

function application() {
  return createContentKnowledgeApplication('knowledge-test', authentication)
}

function resource(app: BackendApplicationSpecV1, id: string) {
  const result = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!result) throw new Error('Missing content resource: ' + id)
  return result
}

describe('content and knowledge-base template authority', () => {
  test('normalizes the complete application and keeps identity configuration independent', () => {
    const app = application()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(
      app.commands?.commands.every(
        (command) => command.steps.length > 0 && !command.commerceOperation
      )
    ).toBe(true)
    const client = app.httpApi?.browserClient
    if (!client) throw new Error('Missing browser client')
    client.authentication.scopes.push('email')
    expect(authentication.scopes).toEqual(['openid', 'profile'])
    expect(application().httpApi?.browserClient?.authentication.scopes).toEqual([
      'openid',
      'profile'
    ])
  })

  test('public and internal reading cannot inherit staff access to drafts or audit records', () => {
    const app = application()
    for (const id of ['published-articles', 'internal-articles']) {
      const declaration = resource(app, id)
      const policies = app.auth.rowAccess.filter((entry) =>
        declaration.readPolicyIds?.includes(entry.id)
      )
      expect(policies).toHaveLength(1)
      expect(policies[0]?.conditions).toContainEqual({ fieldId: 'status', value: 'published' })
      expect(policies[0]?.principal.kind).toBe(
        id === 'published-articles' ? 'anonymous' : 'authenticated'
      )
      expect(declaration.readFields).not.toContain('owner_id')
      expect(declaration.readFields).not.toContain('note')
      expect(declaration.query?.filterFields).not.toContain('status')
      if (id === 'published-articles')
        expect(policies[0]?.conditions).toContainEqual({ fieldId: 'visibility', value: 'public' })
    }
    for (const id of ['articles', 'article-history']) {
      const declaration = resource(app, id)
      expect(
        app.auth.rowAccess
          .filter((entry) => declaration.readPolicyIds?.includes(entry.id))
          .every((entry) => ['owner', 'role'].includes(entry.principal.kind))
      ).toBe(true)
    }
  })

  test('content and audit resources expose no direct write path around review commands', () => {
    const app = application()
    for (const declaration of app.httpApi?.resources ?? []) {
      expect(declaration.operations).toEqual(['list', 'read'])
      expect(declaration.createFields).toBeUndefined()
      expect(declaration.updateFields).toBeUndefined()
    }
    expect(
      app.auth.rowAccess.every((entry) =>
        entry.operations.every((operation) => operation === 'select')
      )
    ).toBe(true)
    const history = app.dataModel.entities.find((entry) => entry.name === 'article_history')
    expect(history?.foreignKeys).toContainEqual({
      id: 'article-id-owner',
      fields: ['article_id', 'owner_id'],
      targetEntityId: 'business-articles',
      targetFields: ['id', 'owner_id'],
      onDelete: 'restrict'
    })
    const commands =
      app.commands?.commands.filter((entry) => entry.id !== 'register-business-user') ?? []
    expect(commands).toHaveLength(8)
    for (const command of commands) {
      const historyWrites = command.steps.filter(
        (step) => step.kind === 'data.mutate' && step.entityId === history?.id
      )
      expect(historyWrites).toHaveLength(1)
      expect(historyWrites[0]?.kind === 'data.mutate' && historyWrites[0].operation).toBe('insert')
      expect(
        command.parameters.some((parameter) =>
          ['owner_id', 'actor_id', 'status', 'published_at'].includes(parameter.name)
        )
      ).toBe(false)
    }
  })

  test('publication filters are validated as typed server conditions', () => {
    for (const change of ['unknown-field', 'wrong-type', 'unknown-enum'] as const) {
      const app = application()
      const policy = app.auth.rowAccess.find((entry) => entry.id === 'published-articles')
      if (!policy) throw new Error('Missing public read policy')
      policy.conditions = [
        {
          fieldId: change === 'unknown-field' ? 'untrusted_column' : 'status',
          value: change === 'wrong-type' ? true : 'unreviewed'
        }
      ]
      const parsed = parseBackendApplicationSpecV1(app)
      expect(parsed.ok).toBe(false)
    }
  })
})
