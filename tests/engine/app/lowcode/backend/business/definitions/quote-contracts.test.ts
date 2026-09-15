import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { quoteContractsDefinition } from '@/app/lowcode/backend/business/definitions/contracts'
import { createContractsApplication } from '@/app/lowcode/backend/business/model/contracts/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

const definition = quoteContractsDefinition()
const application = () =>
  createContractsApplication('contracts-pages', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'contracts-pages',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
const action = (id: string) => {
  const found = definition.pages
    .flatMap((page) => page.actions)
    .find((entry) => entry.commandId === id)
  if (!found) throw new Error('Missing contract action ' + id)
  return found
}

describe('quotation and contract pages', () => {
  for (const locale of ['en', 'zh-CN'])
    test(`renders seven ${locale} pages with valid bounded expressions`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), definition.id, { locale })
      const result = editor.undo.runBatch('Contract pages test', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(result.pageIds).toHaveLength(7)
      const nodes = [...editor.graph.getAllNodes()]
      expect(nodes.length).toBeLessThan(20000)
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
      for (const page of definition.pages)
        expect(
          nodes.some(
            (node) =>
              node.type === 'TEXT' && node.text === page.title[locale === 'en' ? 'en' : 'zh']
          )
        ).toBe(true)
    })

  test('preflights every command with actual field sources and no public or payment page', () => {
    const app = application()
    expect(() => preflightBusinessPages(app, definition)).not.toThrow()
    expect(
      definition.pages
        .flatMap((page) => page.actions)
        .map((entry) => entry.commandId)
        .sort()
    ).toEqual(app.commands?.commands.map((entry) => entry.id).sort())
    expect(definition.entryPage).toBe('quote-drafts')
    expect(definition.pages.some((page) => page.public)).toBe(false)
    expect(definition.pages.map((page) => page.id)).toEqual([
      'account',
      'contract-parties',
      'quote-drafts',
      'quote-versions',
      'contracts',
      'contract-deliveries'
    ])
    expect(definition.description.zh).toContain('电子签名、真实回款及 CRM 同步需导出后开发')
  })

  test('uses frozen draft revision for confirmation and current parent revision for acceptance', () => {
    expect(action('confirm-quote-contract').parameters).toMatchObject({
      draftId: { kind: 'selection', field: 'draft_id' },
      quoteVersionId: { kind: 'selection', field: 'id' },
      expectedVersion: { kind: 'selection', field: 'draft_version' }
    })
    const accept = action('accept-contract-delivery')
    expect(accept.parameters).toMatchObject({
      contractId: { kind: 'selection', field: 'id' },
      expectedVersion: { kind: 'selection', field: 'version' }
    })
    expect(accept.inputs[0].relation).toMatchObject({
      resourceId: 'contract-deliveries',
      filters: {
        contract_id: { kind: 'selection', field: 'id' },
        sequence: { kind: 'selection', field: 'next_accept_sequence' },
        status: { kind: 'literal', value: 'submitted' }
      }
    })
    expect(accept.description.zh).toContain('内部登记不冒充客户验收')
    expect(
      action('confirm-quote-contract').inputs.find((input) => input.key === 'reference')?.required
    ).toBe(true)
    expect(action('cancel-contract').inputs.find((input) => input.key === 'note')?.required).toBe(
      true
    )
  })

  test('prefills selected values and confines edits and fulfillment to their valid states', () => {
    const edit = action('update-quote-draft')
    expect(edit.when).toEqual({ field: 'status', values: ['draft'] })
    expect(edit.inputs.find((input) => input.key === 'partyId')?.fromSelection).toBe('party_id')
    expect(edit.inputs.find((input) => input.key === 'unitPriceCents')?.fromSelection).toBe(
      'unit_price_cents'
    )
    expect(
      action('update-contract-party')
        .inputs.find((input) => input.key === 'active')
        ?.choices?.map((choice) => choice.value)
    ).toEqual([true, false])
    for (const id of [
      'record-contract-delivery',
      'accept-contract-delivery',
      'close-contract',
      'cancel-contract'
    ])
      expect(action(id).when).toEqual({ field: 'status', values: ['active'] })
    expect(definition.pages.find((page) => page.id === 'contract-deliveries')?.actions).toEqual([])
  })
})
