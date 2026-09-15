import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { foodOrderingDefinition } from '@/app/lowcode/backend/business/definitions/food-ordering'
import { createFoodOrderingApplication } from '@/app/lowcode/backend/business/model/food-ordering/application'
import { prepareBusinessActions } from '@/app/lowcode/backend/business/pages/actions'
import { createBusinessPageContext } from '@/app/lowcode/backend/business/pages/context'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'
import { createBusinessScreen } from '@/app/lowcode/backend/business/pages/screen'

const application = () =>
  createFoodOrderingApplication('food-definition-test', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'food-definition-test',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
const definition = foodOrderingDefinition()
const page = (id: string) => {
  const result = definition.pages.find((entry) => entry.id === id)
  if (!result) throw new Error('Missing food page: ' + id)
  return result
}

describe('restaurant ordering business definition', () => {
  test('exposes six domain pages, shared account and the exact closed command contract', () => {
    expect(definition.id).toBe('food-ordering')
    expect(definition.entryPage).toBe('food-menu')
    expect(definition.roles).toEqual(['food-manager'])
    expect(definition.pages.map((entry) => [entry.id, entry.path])).toEqual([
      ['account', '/account-setup'],
      ['food-menu', '/menu'],
      ['food-cart', '/cart'],
      ['food-checkout', '/checkout'],
      ['food-orders', '/food-orders'],
      ['food-kitchen', '/kitchen'],
      ['food-menu-management', '/menu-management']
    ])
    expect(definition.pages.filter((entry) => entry.public).map((entry) => entry.id)).toEqual([
      'food-menu'
    ])
    const model = application()
    expect(() => preflightBusinessPages(model, definition)).not.toThrow()
    expect(
      [
        ...new Set(
          definition.pages.flatMap((entry) => entry.actions.map((action) => action.commandId))
        )
      ].sort()
    ).toEqual(model.commands?.commands.map((command) => command.id).sort())
  })

  test('shows only current cart lines and sends no client price or total in checkout', () => {
    expect(page('food-cart').listing).toMatchObject({ resourceId: 'food-cart-items' })
    expect(page('food-cart').listing?.filter).toBeUndefined()
    for (const action of page('food-checkout').actions) {
      expect(action.parameters.cartRevision).toEqual({ kind: 'selection', field: 'version' })
      expect(Object.keys(action.parameters)).not.toEqual(
        expect.arrayContaining(['total', 'price', 'userId'])
      )
      expect(action.inputs.find((input) => input.key === 'contactName')?.required).not.toBe(false)
      expect(action.inputs.find((input) => input.key === 'phone')?.required).toBe(false)
    }
    expect(page('food-checkout').actions[0].inputs[0]).toMatchObject({
      key: 'tableNumber',
      maxLength: 32
    })
    expect(
      page('food-checkout').actions[1].inputs.some((input) => input.key === 'tableNumber')
    ).toBe(false)
    expect(page('food-checkout').description.zh).toContain('不收款')
  })

  test('keeps customer and kitchen resources separate and restricts visible state transitions', () => {
    expect(page('food-orders').listing?.resourceId).toBe('food-orders')
    expect(page('food-kitchen').listing?.resourceId).toBe('food-kitchen-orders')
    expect(page('food-orders').related?.map((entry) => entry.resourceId)).toEqual([
      'food-order-items',
      'food-order-history'
    ])
    expect(page('food-kitchen').related?.map((entry) => entry.resourceId)).toEqual([
      'food-kitchen-items',
      'food-kitchen-history'
    ])
    const actions = [...page('food-orders').actions, ...page('food-kitchen').actions]
    for (const [id, statuses] of Object.entries({
      cancel: ['pending'],
      accept: ['pending'],
      prepare: ['accepted'],
      ready: ['preparing'],
      complete: ['ready'],
      reject: ['pending', 'accepted', 'preparing', 'ready']
    }))
      expect(actions.find((entry) => entry.id === 'food.order.' + id)?.when).toEqual({
        field: 'status',
        values: statuses
      })
    expect(page('food-kitchen').description.en).toContain('Refresh list')
    expect(page('food-kitchen').description.zh).toContain('实时')
  })

  test('required boolean choices accept false while maintaining a typed command payload', () => {
    const editor = createEditor()
    const root = editor.graph.getNode(editor.graph.rootId)
    if (!root) throw new Error('Missing graph root')
    const context = createBusinessPageContext(editor, root, application(), definition, 'en')
    const screen = createBusinessScreen(context, page('food-menu-management'))
    for (const prepared of prepareBusinessActions(screen)) {
      const availability = prepared.inputs.entries.find((entry) => entry.input.key === 'available')
      if (!availability) throw new Error('Missing availability choice')
      expect(prepared.command.allowed).toContain('!!(' + availability.state.name + ')')
      expect(prepared.command.allowed).not.toContain('!!(' + availability.valueExpr + ')')
      expect(availability.valueExpr).toContain('? !1 :')
      expect(parseExpression(availability.valueExpr).ok).toBe(true)
    }
  })

  for (const locale of ['en', 'zh-CN'])
    test(`renders ${locale} pages with local primary-list refresh and valid expressions`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), 'food-ordering', { locale })
      const result = editor.undo.runBatch('Food definition test', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(result.pageIds).toHaveLength(8)
      const nodes = [...editor.graph.getAllNodes()]
      const refresh = nodes.filter(
        (node) => node.name === (locale === 'en' ? 'Refresh list' : '刷新列表')
      )
      expect(refresh.length).toBeGreaterThanOrEqual(7)
      for (const button of refresh) {
        const actions = button.events?.onClick ?? []
        expect(actions).toHaveLength(4)
        expect(actions.map((action) => action.kind)).toEqual([
          'setVariable',
          'setState',
          'setState',
          'setState'
        ])
        expect(JSON.stringify(actions)).not.toMatch(
          /backendRequest|command|navigate|Attempt|Busy|Pending/u
        )
      }
      for (const node of nodes) {
        const source = node.interactiveProps?.dataSourceRef
        if (source?.kind === 'backendResource' && source.afterExpr)
          expect(parseExpression(source.afterExpr).ok).toBe(true)
        if (node.renderCondition) expect(parseExpression(node.renderCondition).ok).toBe(true)
      }
      const inverse = nodes
        .filter((node) => node.name === (locale === 'en' ? 'Edit menu item' : '编辑菜品'))
        .flatMap((node) => node.events?.onClick ?? [])
      expect(JSON.stringify(inverse)).toContain('.available === !1')
    })
})
