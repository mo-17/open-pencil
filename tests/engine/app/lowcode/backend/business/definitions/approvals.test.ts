import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { enterpriseApprovalsDefinition } from '@/app/lowcode/backend/business/definitions/approvals'
import { createApprovalsApplication } from '@/app/lowcode/backend/business/model/approvals/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

const definition = enterpriseApprovalsDefinition()
const application = () =>
  createApprovalsApplication('approvals-pages', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'approvals-pages',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
const action = (id: string) => {
  const entry = definition.pages
    .flatMap((page) => page.actions)
    .find((value) => value.commandId === id)
  if (!entry) throw new Error('Missing approval action ' + id)
  return entry
}

describe('enterprise approval page definition', () => {
  for (const locale of ['en', 'zh-CN'])
    test(`renders all eight ${locale} pages with strict query expressions`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), definition.id, { locale })
      const result = editor.undo.runBatch('Approval pages test', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(result.pageIds).toHaveLength(8)
      const nodes = [...editor.graph.getAllNodes()]
      for (const node of nodes) {
        if (node.renderCondition) expect(parseExpression(node.renderCondition).ok).toBe(true)
        const source = node.interactiveProps?.dataSourceRef
        if (source?.kind === 'backendResource')
          for (const expression of [
            source.afterExpr,
            source.searchExpr,
            ...(source.filterEntries ?? []).map((entry) => entry.valueExpr)
          ])
            if (expression) expect(parseExpression(expression).ok).toBe(true)
      }
      for (const screen of definition.pages)
        expect(
          nodes.some(
            (node) =>
              node.type === 'TEXT' && node.text === screen.title[locale === 'en' ? 'en' : 'zh']
          )
        ).toBe(true)
    })
  test('creates separate private draft presets, owner tracking and two role queues', () => {
    expect(definition.id).toBe('enterprise-approvals')
    expect(definition.roles).toEqual(['oa-reviewer', 'oa-approver'])
    expect(definition.entryPage).toBe('oa-requests')
    expect(definition.pages.map((page) => [page.id, page.path])).toEqual([
      ['account', '/account-setup'],
      ['oa-leave-requests', '/approvals/leave'],
      ['oa-expense-requests', '/approvals/expense'],
      ['oa-purchase-requests', '/approvals/purchase'],
      ['oa-requests', '/approvals/requests'],
      ['oa-first-queue', '/approvals/review'],
      ['oa-second-queue', '/approvals/approve']
    ])
    expect(definition.pages.some((page) => page.public)).toBe(false)
    expect(definition.pages.find((page) => page.id === 'oa-requests')?.related?.[0]).toMatchObject({
      resourceId: 'oa-history',
      foreignKey: 'request_id'
    })
    expect(definition.pages.find((page) => page.id === 'oa-first-queue')?.related).toBeUndefined()
  })

  test('preflights exact parameters for all 14 commands using the real model', () => {
    const app = application()
    expect(() => preflightBusinessPages(app, definition)).not.toThrow()
    const actions = definition.pages.flatMap((page) => page.actions)
    expect(actions).toHaveLength(14)
    expect(actions.map((entry) => entry.commandId).sort()).toEqual(
      app.commands?.commands.map((entry) => entry.id).sort()
    )
    for (const entry of actions.filter(
      (value) =>
        value.commandId !== 'register-business-user' && !value.commandId.startsWith('create-')
    )) {
      expect(entry.parameters.requestId).toEqual({ kind: 'selection', field: 'id' })
      expect(entry.parameters.expectedVersion).toEqual({ kind: 'selection', field: 'version' })
      expect(entry.inputs.map((input) => input.key)).not.toContain('expectedVersion')
    }
    expect(action('create-oa-leave').inputs.map((input) => input.key)).toEqual([
      'title',
      'description',
      'startsAt',
      'endsAt'
    ])
    expect(action('create-oa-expense').inputs.map((input) => input.key)).toEqual([
      'title',
      'description',
      'amountCents'
    ])
  })

  test('limits editing to the correct kind resource and draft state with typed field prefill', () => {
    for (const kind of ['leave', 'expense', 'purchase']) {
      const entry = action(`update-oa-${kind}`)
      expect(entry.when).toEqual({ field: 'status', values: ['draft'] })
      const page = definition.pages.find((candidate) => candidate.actions.includes(entry))
      expect(page?.listing?.resourceId).toBe(`oa-${kind}-requests`)
      expect(entry.inputs.find((input) => input.key === 'title')?.fromSelection).toBe('title')
      expect(
        entry.inputs.find((input) => input.key === (kind === 'leave' ? 'startsAt' : 'amountCents'))
          ?.fromSelection
      ).toBe(kind === 'leave' ? 'starts_at' : 'amount_cents')
    }
    expect(action('reopen-oa-request').when).toEqual({ field: 'status', values: ['rejected'] })
    expect(action('submit-oa-request').when).toEqual({ field: 'status', values: ['draft'] })
    expect(action('cancel-oa-request').when).toEqual({
      field: 'status',
      values: ['draft', 'pending_first', 'pending_second', 'rejected']
    })
  })

  test('requires a rejection note and makes two-person approval and record-only money explicit', () => {
    for (const level of ['first', 'second']) {
      expect(action(`reject-oa-${level}`).inputs[0].required).toBe(true)
      expect(action(`approve-oa-${level}`).inputs[0].required).toBe(false)
    }
    expect(definition.description.zh).toContain('固定两级不同人审批')
    expect(
      definition.pages.find((page) => page.id === 'oa-second-queue')?.description.en
    ).toContain('different from both the applicant and the first reviewer')
    expect(
      definition.pages.find((page) => page.id === 'oa-expense-requests')?.description.zh
    ).toContain('通过审批仅记录决定')
    for (const page of definition.pages) {
      expect(page.title.en.length).toBeGreaterThan(0)
      expect(page.title.zh.length).toBeGreaterThan(0)
      expect(page.description.en.length).toBeGreaterThan(0)
      expect(page.description.zh.length).toBeGreaterThan(0)
    }
  })
})
