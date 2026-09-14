export const COMMERCE_AUTHORIZATION_SOURCE = String.raw`import { ForbiddenException } from '@nestjs/common'
import type { DatabaseTransaction } from './database.service.js'
import type { VerifiedPrincipal } from './identity.js'
import type { CommandPlan } from './command-types.js'
import { cart, missing, one, storeMember, type Context, type Input, type Row } from './commerce-data.js'

export function requireSimulator(): void {
  if (process.env.NODE_ENV !== 'development' || process.env.OPENPENCIL_COMMERCE_PAYMENT_MODE !== 'simulator')
    throw new ForbiddenException('Development payment simulator is disabled.')
}
async function orderContext(client: DatabaseTransaction, order: Row, principal: VerifiedPrincipal, merchant: boolean, buyer: boolean): Promise<Context> {
  if (buyer && order.owner_id !== principal.subject) missing()
  if (merchant) await storeMember(client, order.store_id, principal.subject)
  const group = await one(client, 'paymentGroups', { id: order.payment_group_id })
  const locked = await one(client, 'orders', { id: order.id, payment_group_id: group.id })
  if (locked.store_id !== order.store_id || (buyer && locked.owner_id !== principal.subject)) missing()
  return { group, order: locked }
}
/** Current identity, ownership and membership are checked before any saved response is read. */
export async function authorizeCommerce(client: DatabaseTransaction, plan: CommandPlan, input: Input, principal: VerifiedPrincipal): Promise<Context> {
  const operation = plan.commerceOperation
  if (!operation) return {}
  if (operation === 'payment.simulate' || operation === 'refund.approve') requireSimulator()
  if (operation.startsWith('cart.')) {
    const ownedCart = await cart(client, principal.subject)
    if (operation === 'cart.remove') await one(client, 'cartItems', { id: input.itemId, cart_id: ownedCart.id, owner_id: principal.subject })
    return { cart: ownedCart }
  }
  if (operation === 'purchase.cancel' || operation === 'payment.simulate')
    return { group: await one(client, 'paymentGroups', { id: input.purchaseId, owner_id: principal.subject }) }
  if (operation === 'inventory.restock') {
    await storeMember(client, input.storeId, principal.subject)
    return { product: await one(client, 'products', { id: input.skuId, store_id: input.storeId }) }
  }
  if (operation === 'refund.approve' || operation === 'refund.reject') {
    const refund = await one(client, 'refunds', { id: input.refundId }, false)
    const order = await one(client, 'orders', { id: refund.order_id }, false)
    return { ...await orderContext(client, order, principal, false, false), refund: await one(client, 'refunds', { id: refund.id }) }
  }
  if (operation === 'settlement.record') {
    const settlement = await one(client, 'settlements', { id: input.settlementId }, false)
    const order = await one(client, 'orders', { id: settlement.order_id }, false)
    return { ...await orderContext(client, order, principal, false, false), settlement: await one(client, 'settlements', { id: settlement.id }) }
  }
  const order = await one(client, 'orders', { id: input.orderId }, false)
  return orderContext(client, order, principal, operation === 'shipment.dispatch', operation !== 'shipment.dispatch')
}
`
