import { setCommerceState as set } from '../state'
import { createOperation } from './actions'
import type { OperationsContext } from './context'
import { createOperationsScreen } from './screen'

export function createOperationsCart(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const s = createOperationsScreen(ctx, 'cart', 1980, c.cartHint + ' ' + c.currency)
  const sku = s.field('Sku'),
    item = s.field('Item'),
    title = s.field('Title')
  const quantity = s.field('Quantity', 'number', 1)
  const valid = `${s.current} && !!${sku.name} && ${quantity.name} >= 1 && ${quantity.name} <= 99 && ${quantity.name} % 1 === 0`
  const save = createOperation(
    s,
    'cart.set',
    [
      { key: 'skuId', valueExpr: sku.name },
      { key: 'quantity', valueExpr: quantity.name }
    ],
    valid,
    c.add
  )
  const remove = createOperation(
    s,
    'cart.remove',
    [{ key: 'itemId', valueExpr: item.name }],
    `${s.current} && !!${item.name}`,
    c.remove
  )
  const locked = `(${save.locked} || ${remove.locked})`
  const rows = s.list('cart-items', c.cart, 224, 170, [{ key: 'active', valueExpr: '!0' }])
  s.bound(
    rows.card,
    'item.product_title + " · " + item.quantity + " × " + item.unit_price + " = " + item.line_total',
    18,
    60
  )
  l.button(
    rows.card,
    c.select,
    16,
    104,
    s.select(
      [sku, 'item.sku_id'],
      [item, 'item.id'],
      [title, 'item.product_title'],
      [quantity, 'item.quantity']
    ),
    { renderCondition: `!${locked}` }
  )
  const summary = s.list('carts', c.summary, 598, 120)
  s.bound(
    summary.card,
    `${JSON.stringify(c.subtotal + ': ')} + item.subtotal + " · " + item.item_count`,
    18
  )
  l.button(summary.card, c.checkout, 16, 66, [l.navigate(ctx.paths.checkout)])
  s.bound(s.page, `${s.current} ? ${title.name} : ${JSON.stringify(c.none)}`, 968)
  const form = l.shape('FORM', c.add, s.page, 48, 1010, 880, 150, {
    layoutMode: 'NONE',
    renderCondition: `${s.current} && !!${sku.name} && !${locked}`,
    events: { onSubmit: [save.submit] }
  })
  s.input(form, c.quantity, quantity, 0, { required: true, customExpr: valid })
  l.button(form, c.add, 0, 94, [])
  l.button(form, c.remove, 250, 94, [remove.submit])
  save.feedback(1180)
  remove.feedback(1510)
  s.finish()
}

export function createOperationsCheckout(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const s = createOperationsScreen(ctx, 'checkout', 1450, c.checkoutHint)
  const revision = s.field('Revision', 'number', -1),
    subtotal = s.field('Subtotal', 'number', 0)
  const recipient = s.field('Recipient'),
    phone = s.field('Phone'),
    address = s.field('Address')
  const operation = createOperation(
    s,
    'cart.checkout',
    [
      { key: 'cartRevision', valueExpr: revision.name },
      { key: 'recipient', valueExpr: recipient.name },
      { key: 'phone', valueExpr: phone.name },
      { key: 'address', valueExpr: address.name }
    ],
    `${s.current} && ${revision.name} >= 0 && !!${recipient.name} && !!${phone.name} && !!${address.name}`,
    c.place
  )
  const summary = s.list('carts', c.summary, 224, 160)
  s.bound(
    summary.card,
    `${JSON.stringify(c.total + ': ')} + item.subtotal + " · " + item.item_count`,
    18
  )
  l.button(
    summary.card,
    c.review,
    16,
    82,
    s.select([revision, 'item.version'], [subtotal, 'item.subtotal']),
    {
      renderCondition: `item.item_count > 0 && !${operation.locked}`
    }
  )
  s.bound(
    s.page,
    `${s.current} && ${revision.name} >= 0 ? ${JSON.stringify(c.total + ': ')} + ${subtotal.name} : ${JSON.stringify(c.none)}`,
    592
  )
  const form = l.shape('FORM', c.place, s.page, 48, 640, 890, 350, {
    layoutMode: 'NONE',
    renderCondition: `${s.current} && ${revision.name} >= 0 && !${operation.locked}`,
    events: { onSubmit: [operation.submit] }
  })
  s.input(form, c.recipient, recipient, 0, { required: true, maxLength: 100, pattern: '\\S' })
  s.input(form, c.phone, phone, 86, { required: true, maxLength: 64, pattern: '\\S' })
  s.input(form, c.address, address, 172, { required: true, maxLength: 1000, pattern: '\\S' })
  l.button(form, c.place, 0, 270, [])
  l.button(form, c.cart, 250, 270, [set(revision, '-1'), l.navigate(ctx.paths.cart)])
  operation.feedback(1010)
  l.button(s.page, c.purchases, 660, 1286, [l.navigate(ctx.paths.purchases)])
  s.finish()
}
