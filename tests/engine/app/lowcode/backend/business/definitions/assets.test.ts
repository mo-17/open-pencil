import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { assetManagementDefinition } from '@/app/lowcode/backend/business/definitions/assets'
import { createAssetsApplication } from '@/app/lowcode/backend/business/model/assets/application'
import { businessActionConditionExpression } from '@/app/lowcode/backend/business/pages/conditions'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'
import type { BusinessActionWhen } from '@/app/lowcode/backend/business/types'

const application = () =>
  createAssetsApplication('asset-pages', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'assets',
    scopes: ['openid'],
    callbackPath: '/_openpencil/auth/callback'
  })
const definition = assetManagementDefinition()
function page(id: string) {
  const entry = definition.pages.find((item) => item.id === id)
  if (!entry) throw new Error('Missing asset page ' + id)
  return entry
}
function action(id: string) {
  const entry = definition.pages
    .flatMap((item) => item.actions)
    .find((item) => item.commandId === id)
  if (!entry) throw new Error('Missing asset action ' + id)
  return entry
}

describe('asset management page definition', () => {
  test('gates handover entry and submission while retaining form state and receipt review', () => {
    const editor = createEditor()
    const plan = prepareBusinessModulePages(editor, application(), 'asset-management', {
      locale: 'en'
    })
    renderBusinessModulePages(editor, plan)
    const nodes = [...editor.graph.getAllNodes()]
    for (const kind of ['assignment', 'loan']) {
      const label = action('issue-asset-' + kind).label.en
      const entry = nodes.find(
        (node) =>
          node.type === 'BUTTON' &&
          node.name === label &&
          node.parentId !== null &&
          editor.graph.getNode(node.parentId)?.type !== 'FORM'
      )
      expect(entry?.renderCondition).toContain('.status === "requested"')
      expect(entry?.renderCondition).toContain(`.kind === "${kind}"`)
      const form = nodes.find((node) => node.type === 'FORM' && node.name === label)
      expect(form?.renderCondition).toMatch(/^!businessReviewOnly/u)
      expect(form?.renderCondition).not.toContain('.status')
      const submit = form?.events?.onSubmit?.[0]
      expect(submit?.kind).toBe('condition')
      if (submit?.kind !== 'condition') throw new Error('Missing guarded form submit')
      expect(submit.condExpr).toContain(entry?.renderCondition ?? 'Missing action availability')
      const panel = nodes.find((node) => node.type === 'FRAME' && node.name === label + ' panel')
      // Clearing selection after success must preserve receipt review and retry controls.
      expect(panel?.renderCondition).not.toContain('.status')
      const inspect = nodes.find(
        (node) =>
          node.type === 'BUTTON' &&
          node.name.endsWith(' · ' + label) &&
          node.parentId === entry?.parentId
      )
      expect(inspect?.renderCondition).toBe(`!(${entry?.renderCondition})`)
    }
    const create = nodes.find((node) => node.type === 'BUTTON' && node.name === 'Register asset')
    expect(create?.renderCondition).toBeUndefined()
  })

  test('retains old scalar conditions and rejects malformed or unbounded conjunctions before rendering', () => {
    expect(
      businessActionConditionExpression({ field: 'active', values: [false] }, 'selected')
    ).toBe('(selected.active === !1)')
    const condition = { field: 'status', values: ['requested'] }
    const conjunction = { all: [condition, { field: 'kind', values: ['assignment', 'loan'] }] }
    const expression = businessActionConditionExpression(conjunction, 'selected')
    expect(expression).toBe(
      '(selected.status === "requested") && (selected.kind === "assignment" || selected.kind === "loan")'
    )
    expect(parseExpression(expression).ok).toBe(true)
    const withWhen = (when: unknown) => ({
      ...definition,
      pages: definition.pages.map((current) => ({
        ...current,
        actions: current.actions.map((entry) =>
          entry.commandId === 'issue-asset-assignment'
            ? { ...entry, when: when as BusinessActionWhen }
            : entry
        )
      }))
    })
    expect(() => preflightBusinessPages(application(), withWhen(condition))).not.toThrow()
    expect(() => preflightBusinessPages(application(), withWhen(conjunction))).not.toThrow()
    for (const invalid of [
      null,
      false,
      { all: [] },
      { all: Array.from({ length: 5 }, () => condition) },
      { all: [{ all: [condition] }] },
      { ...condition, values: [] },
      { ...condition, values: Array.from({ length: 17 }, () => 'requested') },
      { ...condition, values: [null] },
      { ...condition, values: ['x'.repeat(201)] },
      { ...condition, expression: 'arbitrary()' },
      { all: [condition, { field: 'owner_id', values: ['unread'] }] }
    ])
      expect(() => preflightBusinessPages(application(), withWhen(invalid))).toThrow()
  })

  test('covers all thirteen real commands without public custody or direct audit editing', () => {
    const model = application()
    expect(() => preflightBusinessPages(model, definition)).not.toThrow()
    expect(definition.id).toBe('asset-management')
    expect(definition.entryPage).toBe('assets')
    expect(definition.roles).toEqual(['asset-manager'])
    expect(definition.pages.map((entry) => entry.path)).toEqual([
      '/account-setup',
      '/assets',
      '/assets/my-requests',
      '/assets/admin',
      '/assets/admin/requests',
      '/assets/admin/history'
    ])
    expect(definition.pages.some((entry) => entry.public)).toBe(false)
    expect(
      definition.pages
        .flatMap((entry) => entry.actions)
        .map((entry) => entry.commandId)
        .sort()
    ).toEqual(model.commands?.commands.map((entry) => entry.id).sort())
    expect(page('asset-history').actions).toEqual([])
    expect(page('asset-requests').listing?.resourceId).toBe('asset-requests')
    expect(page('asset-requests').related).toBeUndefined()
    expect(page('asset-management-requests').related?.[0]).toMatchObject({
      resourceId: 'asset-history',
      foreignKey: 'request_id'
    })
    expect(page('asset-management').related?.[0]).toMatchObject({
      resourceId: 'asset-history',
      foreignKey: 'asset_id'
    })
  })

  test('binds stored request identity, revision and loan deadline instead of allowing a replacement borrower', () => {
    for (const id of [
      'issue-asset-assignment',
      'issue-asset-loan',
      'return-asset-request',
      'reject-asset-request',
      'cancel-asset-request'
    ]) {
      const current = action(id)
      expect(current.parameters).toMatchObject({
        assetId: { kind: 'selection', field: 'asset_id' },
        requestId: { kind: 'selection', field: 'id' },
        expectedVersion: { kind: 'selection', field: 'version' }
      })
      expect(current.inputs.map((input) => input.key)).toEqual(['note'])
      expect(current.parameters).not.toHaveProperty('borrowerId')
    }
    expect(action('issue-asset-loan').parameters.dueAt).toEqual({
      kind: 'selection',
      field: 'due_at'
    })
    expect(action('issue-asset-assignment').parameters).not.toHaveProperty('dueAt')
    expect(action('request-asset-loan').inputs.map((input) => input.key)).toEqual([
      'borrowerName',
      'purpose',
      'dueAt'
    ])
    expect(action('request-asset-assignment').inputs.map((input) => input.key)).toEqual([
      'borrowerName',
      'purpose'
    ])
    expect(action('cancel-asset-request').when).toEqual({ field: 'status', values: ['requested'] })
  })

  test('keeps permanent tags immutable and describes the physical/manual operating boundary', () => {
    expect(action('update-asset').inputs.map((input) => input.key)).not.toContain('tag')
    for (const id of [
      'update-asset',
      'start-asset-repair',
      'complete-asset-repair',
      'retire-asset'
    ])
      expect(action(id).parameters.expectedVersion).toEqual({ kind: 'selection', field: 'version' })
    expect(action('start-asset-repair').when).toEqual({ field: 'status', values: ['available'] })
    expect(action('complete-asset-repair').when).toEqual({ field: 'status', values: ['repair'] })
    expect(page('assets').description.zh).toContain('不会预留资产')
    expect(page('asset-management').description.zh).toContain('不会自动同步')
    expect(action('request-asset-loan').description.zh).toContain('不会自动发送')
    expect(page('asset-management-requests').description.zh).toContain('实物')
  })

  for (const locale of ['en', 'zh-CN'])
    test(`renders ${locale} seven-route asset application with strict expressions`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), 'asset-management', { locale })
      const result = editor.undo.runBatch('Assets fixture', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(result.pageIds).toHaveLength(7)
      const nodes = [...editor.graph.getAllNodes()]
      for (const node of nodes) {
        if (node.renderCondition) expect(parseExpression(node.renderCondition).ok).toBe(true)
        const source = node.interactiveProps?.dataSourceRef
        if (source?.kind !== 'backendResource') continue
        for (const expression of [
          source.afterExpr,
          source.searchExpr,
          ...(source.filterEntries ?? []).map((entry) => entry.valueExpr)
        ])
          if (expression) expect(parseExpression(expression).ok).toBe(true)
      }
      for (const entry of definition.pages)
        expect(
          nodes.some(
            (node) =>
              node.type === 'TEXT' && node.text === entry.title[locale === 'en' ? 'en' : 'zh']
          )
        ).toBe(true)
    })
})
