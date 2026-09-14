export const COMMERCE_EXECUTION_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import type { CommandPlan, CommandRow } from './command-types.js'
import { conflict, projected, type Context, type Input, type Row } from './commerce-data.js'
import { setCartItem, removeCartItem } from './commerce-cart.js'
import { checkoutCart } from './commerce-checkout.js'
import { cancelPurchase, simulatePayment } from './commerce-payment.js'
import { requestRefund, decideRefund } from './commerce-refund.js'
import { dispatchShipment, deliverShipment, recordSettlement, restockInventory } from './commerce-fulfillment.js'

export async function executeCommerce(client: DatabaseTransaction, plan: CommandPlan, input: Input, subject: string, context: Context): Promise<CommandRow> {
  let result: Row
  switch (plan.commerceOperation) {
    case 'cart.set': result = await setCartItem(client, context.cart ?? conflict(), input, subject); break
    case 'cart.remove': result = await removeCartItem(client, context.cart ?? conflict(), input); break
    case 'cart.checkout': result = await checkoutCart(client, context.cart ?? conflict(), input, subject); break
    case 'purchase.cancel': result = await cancelPurchase(client, context.group ?? conflict()); break
    case 'payment.simulate': result = await simulatePayment(client, context.group ?? conflict(), input); break
    case 'refund.request': result = await requestRefund(client, context, input); break
    case 'refund.approve': result = await decideRefund(client, context, input, true); break
    case 'refund.reject': result = await decideRefund(client, context, input, false); break
    case 'shipment.dispatch': result = await dispatchShipment(client, context, input); break
    case 'shipment.deliver': result = await deliverShipment(client, context); break
    case 'settlement.record': result = await recordSettlement(client, context, input); break
    case 'inventory.restock': result = await restockInventory(client, context, input); break
    default: return conflict()
  }
  return projected(result, plan.return.fields)
}
`
