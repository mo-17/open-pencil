export const FOOD_AUTHORIZATION_SOURCE = String.raw`import { ForbiddenException } from '@nestjs/common'
import type { DatabaseTransaction } from './database.service.js'
import type { CommandPlan } from './command-types.js'
import type { VerifiedPrincipal } from './identity.js'
import { FOOD } from './food-model.js'
import { foodCart, foodOne, type FoodInput, type FoodRow } from './food-data.js'

export interface FoodContext { cart?: FoodRow; order?: FoodRow }
/** Current owner/role authority is resolved and locked before idempotency response replay. */
export async function authorizeFoodOrdering(client: DatabaseTransaction, plan: CommandPlan, input: FoodInput, principal: VerifiedPrincipal): Promise<FoodContext> {
  const operation = plan.foodOrderingOperation
  if (!operation) return {}
  if (operation.startsWith('cart.') || operation.startsWith('checkout.')) {
    const cart = await foodCart(client, principal.subject)
    if (operation === 'cart.remove') await foodOne(client, 'cartItems', { id: input.itemId, cart_id: cart.id, owner_id: principal.subject })
    return { cart }
  }
  if (operation === 'order.cancel') return { order: await foodOne(client, 'orders', { id: input.orderId, owner_id: principal.subject }) }
  if (!principal.roles.includes(FOOD.managerRoleId)) throw new ForbiddenException('Access denied.')
  return { order: await foodOne(client, 'orders', { id: input.orderId }) }
}
`
