import { setCommerceState as set, setCommerceVariable as variable } from '../state'
import { createOperation } from './actions'
import type { OperationsContext } from './context'
import { createOperationsScreen, EMPTY_COMMERCE_ID } from './screen'

export function createOperationsShop(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const s = createOperationsScreen(ctx, 'shop', 1400, c.cartHint + ' ' + c.currency, false)
  const sku = s.field('Sku'),
    title = s.field('Title'),
    quantity = s.field('Quantity', 'number', 1)
  const search = s.field('Search'),
    searchInput = s.field('SearchInput')
  const valid = `${s.current} && !!${sku.name} && ${quantity.name} >= 1 && ${quantity.name} <= 99 && ${quantity.name} % 1 === 0`
  const operation = createOperation(
    s,
    'cart.set',
    [
      { key: 'skuId', valueExpr: sku.name },
      { key: 'quantity', valueExpr: quantity.name }
    ],
    valid,
    c.add
  )
  const form = l.shape('FORM', c.search, s.page, 48, 216, 890, 92, {
    layoutMode: 'NONE',
    events: { onSubmit: [set(search, searchInput.name)] }
  })
  l.shape('INPUT', c.search, form, 0, 0, 580, 42, {
    bindings: { value: { kind: 'ref', stateId: searchInput.id } },
    interactiveProps: { placeholder: c.search, validation: { maxLength: 120 } }
  })
  l.button(form, c.search, 620, 0, [])
  l.button(s.page, c.stores, 48, 274, [l.navigate(ctx.paths.stores)])
  l.button(s.page, c.reset, 280, 274, [
    variable(ctx.browseStore, '""'),
    set(search, '""'),
    set(searchInput, '""')
  ])
  for (const filtered of [false, true]) {
    const rows = s.list(
      'products',
      c.shop,
      340,
      180,
      [
        { key: 'active', valueExpr: '!0' },
        ...(filtered
          ? [{ key: 'store_id', valueExpr: `${ctx.browseStore} || "${EMPTY_COMMERCE_ID}"` }]
          : [])
      ],
      { searchExpr: search.name, sortField: 'price', sortDirection: 'asc' },
      filtered ? `!!${ctx.browseStore}` : `!${ctx.browseStore}`
    )
    s.bound(rows.card, 'item.title', 16)
    s.bound(
      rows.card,
      'item.price + " · " + ' + JSON.stringify(c.stock + ': ') + ' + item.stock',
      58
    )
    l.button(
      rows.card,
      c.select,
      16,
      112,
      s.select([sku, 'item.id'], [title, 'item.title'], [quantity, '1']),
      { renderCondition: `item.stock > 0 && !${operation.locked}` }
    )
  }
  s.bound(s.page, `${s.current} ? ${title.name} : ${JSON.stringify(c.none)}`, 706)
  const add = l.shape('FORM', c.add, s.page, 48, 754, 890, 152, {
    layoutMode: 'NONE',
    renderCondition: `${s.current} && !!${sku.name} && !${operation.locked} && $currentUser.signedIn`,
    events: { onSubmit: [operation.submit] }
  })
  s.input(add, c.quantity, quantity, 0, { required: true, customExpr: valid })
  l.button(add, c.add, 0, 98, [])
  operation.feedback(928)
  s.finish()
}

export function createOperationsStores(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const directory = createOperationsScreen(ctx, 'stores', 720, c.storeHint, false)
  const rows = directory.list('stores', c.stores, 224, 150)
  directory.bound(rows.card, 'item.title', 18)
  l.button(rows.card, c.visit, 16, 80, [
    variable(ctx.browseStore, 'item.id'),
    l.navigate(ctx.paths.shop)
  ])
  directory.finish()
  const s = createOperationsScreen(
    ctx,
    'myStore',
    1200,
    c.storeHint + (ctx.mode === 'single-merchant' ? ' ' + c.singleHint : '')
  )
  const title = s.field('Title'),
    busy = s.field('Busy', 'boolean', false)
  const generation = s.field('CreateGeneration')
  const creating = `(${busy.name} && ${generation.name} === ("" + $currentUser.generation))`
  const result = ctx.doc('createdStore', 'object')
  const own = s.list('my-store', c.myStore, 224, 150)
  s.bound(own.card, 'item.title', 18)
  l.button(own.card, c.manage, 16, 80, [
    {
      id: crypto.randomUUID(),
      kind: 'backendRequest',
      resourceId: 'my-store',
      operation: 'read',
      idExpr: 'item.id',
      resultTarget: ctx.store,
      errorTarget: s.error,
      onSuccess: [l.navigate(ctx.paths.admin)]
    }
  ])
  const form = l.shape('FORM', c.createStore, s.page, 48, 598, 890, 152, {
    layoutMode: 'NONE',
    renderCondition: `!${creating}`,
    events: {
      onSubmit: [
        set(generation, '"" + $currentUser.generation'),
        set(busy, '!0'),
        {
          id: crypto.randomUUID(),
          kind: 'backendRequest',
          resourceId: 'stores',
          operation: 'create',
          payloadEntries: [{ key: 'title', valueExpr: title.name }],
          resultTarget: result,
          errorTarget: s.error,
          onSuccess: [set(busy, '!1'), set(title, '""')],
          onError: [set(busy, '!1')]
        }
      ]
    }
  })
  s.input(form, c.title, title, 0, { required: true, maxLength: 100, pattern: '\\S' })
  l.button(form, c.createStore, 0, 96, [])
  l.text(s.page, c.created, 48, 784, 880, { renderCondition: `!!${result}.id` })
  for (const [index, key] of (['merchantOrders', 'settlements', 'operator'] as const).entries())
    l.button(s.page, c[key], 48 + index * 290, 872, [l.navigate(ctx.paths[key])], { width: 264 })
  l.text(s.page, c.operatorHint, 48, 938, 880, { height: 64, fontSize: 14 })
  s.finish()
}
