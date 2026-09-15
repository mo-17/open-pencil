import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { procurementInventoryDefinition } from '@/app/lowcode/backend/business/definitions/inventory'
import { createInventoryApplication } from '@/app/lowcode/backend/business/model/inventory/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

const application = () =>
  createInventoryApplication('inventory-pages', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'inventory-pages',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
const definition = procurementInventoryDefinition()
function page(id: string) {
  const entry = definition.pages.find((item) => item.id === id)
  if (!entry) throw new Error('Missing inventory page ' + id)
  return entry
}
function action(id: string) {
  const entry = definition.pages
    .flatMap((item) => item.actions)
    .find((item) => item.commandId === id)
  if (!entry) throw new Error('Missing inventory action ' + id)
  return entry
}

describe('procurement and inventory pages', () => {
  test('covers every real command in an authenticated nine-route application', () => {
    const model = application()
    expect(() => preflightBusinessPages(model, definition)).not.toThrow()
    expect(definition.id).toBe('procurement-inventory')
    expect(definition.roles).toEqual(['inventory-manager', 'inventory-operator'])
    expect(definition.entryPage).toBe('inventory-balances')
    expect(definition.pages.map((entry) => entry.path)).toEqual([
      '/account-setup',
      '/inventory/skus',
      '/inventory/warehouses',
      '/inventory/suppliers',
      '/inventory/stock',
      '/inventory/purchases',
      '/inventory/issues',
      '/inventory/ledger'
    ])
    expect(definition.pages.some((entry) => entry.public)).toBe(false)
    expect(
      definition.pages
        .flatMap((entry) => entry.actions)
        .map((entry) => entry.commandId)
        .sort()
    ).toEqual(model.commands?.commands.map((entry) => entry.id).sort())
    expect(page('inventory-movements').actions).toEqual([])
  })

  test('selects validated catalog references and never asks users to write balances or totals directly', () => {
    const balance = action('create-inventory-balance')
    expect(balance.inputs.map((input) => input.key)).toEqual(['skuId', 'warehouseId'])
    for (const input of balance.inputs)
      expect(input.relation?.filters).toEqual({ active: { kind: 'literal', value: true } })
    const purchase = action('create-inventory-purchase')
    expect(purchase.inputs.map((input) => input.key)).toEqual([
      'balanceId',
      'supplierId',
      'quantity',
      'unitCostCents',
      'note'
    ])
    expect(purchase.inputs.find((input) => input.key === 'supplierId')?.relation?.filters).toEqual({
      active: { kind: 'literal', value: true }
    })
    expect(
      purchase.inputs
        .find((input) => input.key === 'balanceId')
        ?.relation?.columns?.map((column) => column.field)
    ).toEqual(expect.arrayContaining(['sku_title', 'warehouse_title']))
    expect(action('update-inventory-sku').inputs.map((input) => input.key)).not.toContain('unit')
    expect(action('update-inventory-warehouse').inputs.map((input) => input.key)).not.toContain(
      'code'
    )
    for (const entry of definition.pages.flatMap((item) => item.actions))
      expect(Object.keys(entry.parameters)).not.toContain('ownerId')
  })

  test('binds original document IDs for bounded returns and the selected balance revision for counts', () => {
    for (const id of [
      'receive-inventory-purchase',
      'return-inventory-purchase',
      'cancel-inventory-purchase'
    ]) {
      expect(action(id).parameters).toMatchObject({
        balanceId: { kind: 'selection', field: 'balance_id' },
        purchaseId: { kind: 'selection', field: 'id' }
      })
      expect(action(id).when).toEqual({ field: 'status', values: ['ordered'] })
    }
    expect(action('return-inventory-dispatch').parameters).toMatchObject({
      balanceId: { kind: 'selection', field: 'balance_id' },
      dispatchId: { kind: 'selection', field: 'id' }
    })
    expect(action('adjust-inventory-stock').parameters).toMatchObject({
      balanceId: { kind: 'selection', field: 'id' },
      expectedVersion: { kind: 'selection', field: 'version' }
    })
    expect(page('inventory-purchases').related?.[0]).toMatchObject({
      resourceId: 'inventory-movements',
      foreignKey: 'source_id'
    })
    expect(page('inventory-balances').related?.[0]).toMatchObject({
      resourceId: 'inventory-movements',
      foreignKey: 'balance_id'
    })
    expect(page('inventory-purchases').description.zh).toContain('一个商品')
    expect(page('inventory-balances').description.zh).toContain('自动')
  })

  for (const locale of ['en', 'zh-CN'])
    test(`renders ${locale} ordinary pages with strict valid expressions`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), 'procurement-inventory', {
        locale
      })
      const result = editor.undo.runBatch('Inventory test', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(result.pageIds).toHaveLength(9)
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
