export const FOOD_EXECUTION_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import type { CommandPlan, CommandRow } from './command-types.js'
import type { FoodContext } from './food-authorization.js'
import { foodConflict, foodProjection, type FoodInput, type FoodRow } from './food-data.js'
import { setFoodCartItem, removeFoodCartItem } from './food-cart.js'
import { checkoutFoodCart } from './food-checkout.js'
import { transitionFoodOrder } from './food-orders.js'

export async function executeFoodOrdering(client: DatabaseTransaction, plan: CommandPlan, input: FoodInput, subject: string, context: FoodContext): Promise<CommandRow> {
  let result: FoodRow
  switch (plan.foodOrderingOperation) {
    case 'cart.set': result = await setFoodCartItem(client, context.cart ?? foodConflict(), input, subject); break
    case 'cart.remove': result = await removeFoodCartItem(client, context.cart ?? foodConflict(), input); break
    case 'checkout.dine-in': result = await checkoutFoodCart(client, context.cart ?? foodConflict(), input, subject, 'dine_in'); break
    case 'checkout.pickup': result = await checkoutFoodCart(client, context.cart ?? foodConflict(), input, subject, 'pickup'); break
    case 'order.cancel': case 'order.accept': case 'order.prepare': case 'order.ready': case 'order.complete': case 'order.reject':
      result = await transitionFoodOrder(client, context.order ?? foodConflict(), plan, input, subject); break
    default: return foodConflict()
  }
  return foodProjection(result, plan.return.fields)
}
`
