import {
  FOOD_ORDERING_OPERATIONS,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { nestJSArtifact } from '../artifact'
import {
  withReviewedCommandServices,
  type NestJSCommandServiceExtension
} from '../commands/extensions'
import { FOOD_AUTHORIZATION_SOURCE } from './authorization'
import { FOOD_CART_SOURCE } from './cart'
import { FOOD_CHECKOUT_SOURCE } from './checkout'
import { FOOD_DATA_SOURCE } from './data'
import { FOOD_EXECUTION_SOURCE } from './execution'
import { nestJSFoodOrderingModel } from './model'
import { FOOD_ORDERS_SOURCE } from './orders'

function replaceFoodBoundary(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2)
    throw new Error('NestJS food ordering template boundary changed.')
  return source.replace(before, () => after)
}

export function withFoodOrderingCommandTypes(source: string): string {
  return replaceFoodBoundary(
    source,
    '  readonly digest: string',
    '  readonly digest: string\n  readonly foodOrderingOperation?: ' +
      FOOD_ORDERING_OPERATIONS.map((operation) => JSON.stringify(operation)).join(' | ')
  )
}

export const FOOD_COMMAND_EXTENSION: NestJSCommandServiceExtension = {
  imports:
    "import { authorizeFoodOrdering } from './food-authorization.js'\nimport { executeFoodOrdering } from './food-execution.js'\n",
  authorize: 'const foodContext = await authorizeFoodOrdering(client, plan, input, principal)',
  operation: 'foodOrderingOperation',
  execute: 'await executeFoodOrdering(client, plan, input, principal.subject, foodContext)'
}

export function withFoodOrderingCommandService(source: string): string {
  return withReviewedCommandServices(source, [FOOD_COMMAND_EXTENSION])
}

export function emitNestJSFoodOrdering(application: BackendApplicationSpecV1) {
  if (!application.foodOrdering) return []
  const sources = {
    'food-model':
      'export const FOOD = ' +
      JSON.stringify(nestJSFoodOrderingModel(application), null, 2) +
      ' as const\n',
    'food-data': FOOD_DATA_SOURCE,
    'food-authorization': FOOD_AUTHORIZATION_SOURCE,
    'food-cart': FOOD_CART_SOURCE,
    'food-checkout': FOOD_CHECKOUT_SOURCE,
    'food-orders': FOOD_ORDERS_SOURCE,
    'food-execution': FOOD_EXECUTION_SOURCE
  }
  return [
    ...Object.entries(sources).map(([name, source]) =>
      nestJSArtifact('src/' + name + '.ts', source)
    ),
    nestJSArtifact(
      'FOOD-ORDERING.md',
      `# Food ordering\n\nSingle-restaurant dine-in and pickup orders. Money is stored in integer CNY minor units. Checkout rechecks the current menu price and availability in one transaction; changed prices require refreshing the cart. Only the authenticated customer owns their cart and orders. Verified food managers operate the kitchen; UI visibility grants no authority.\n\nOrders progress from pending to accepted, preparing, ready and completed. Customers may cancel pending orders. Managers may reject pending, accepted, preparing or ready orders. Each transition appends history. Reuse the original Idempotency-Key and payload after an uncertain result.\n\nAvailability is a manual sold-out switch, not counted inventory. This template does not accept payments, prove payment, print kitchen tickets, notify staff, allocate pickup numbers, manage table occupancy or deliver food. Add those integrations after export. Never use a browser-supplied amount or status as an authoritative receipt.\n`
    )
  ]
}
