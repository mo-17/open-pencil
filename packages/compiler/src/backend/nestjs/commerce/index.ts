import { COMMERCE_OPERATIONS, type BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSArtifact } from '../artifact'
import { COMMERCE_AUTHORIZATION_SOURCE } from './authorization-source'
import { COMMERCE_CART_SOURCE } from './cart-source'
import { COMMERCE_CHECKOUT_SOURCE } from './checkout-source'
import { COMMERCE_DATA_SOURCE } from './data-source'
import { COMMERCE_EXECUTION_SOURCE } from './execution-source'
import { COMMERCE_FULFILLMENT_SOURCE } from './fulfillment-source'
import { COMMERCE_GATEWAY_SOURCE, COMMERCE_GUIDE } from './gateway-source'
import { nestJSCommerceModel } from './model'
import { COMMERCE_PAYMENT_SOURCE } from './payment-source'
import { COMMERCE_REFUND_SOURCE } from './refund-source'
import { COMMERCE_STOCK_SOURCE } from './stock-source'

function replace(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2)
    throw new Error('NestJS commerce template boundary changed.')
  return source.replace(before, () => after)
}

export function withCommerceCommandTypes(source: string): string {
  return replace(
    source,
    '  readonly digest: string',
    '  readonly digest: string\n  readonly commerceOperation?: ' +
      COMMERCE_OPERATIONS.map((operation) => JSON.stringify(operation)).join(' | ')
  )
}

export function withCommerceCommandService(source: string): string {
  const imported =
    "import { authorizeCommerce } from './commerce-authorization.js'\nimport { executeCommerce } from './commerce-execution.js'\n" +
    source
  const authorized = replace(
    imported,
    '      const inserted = await client.query(',
    '      const commerceContext = await authorizeCommerce(client, plan, input, principal)\n      const inserted = await client.query('
  )
  return replace(
    authorized,
    '      const response = await executeCommand(client, plan, input, principal.subject)',
    '      const response = plan.commerceOperation\n        ? await executeCommerce(client, plan, input, principal.subject, commerceContext)\n        : await executeCommand(client, plan, input, principal.subject)'
  )
}

export function emitNestJSCommerce(application: BackendApplicationSpecV1) {
  if (!application.commerce) return []
  const sources = {
    'commerce-model':
      'export const COMMERCE = ' +
      JSON.stringify(nestJSCommerceModel(application), null, 2) +
      ' as const\n',
    'commerce-data': COMMERCE_DATA_SOURCE,
    'commerce-authorization': COMMERCE_AUTHORIZATION_SOURCE,
    'commerce-cart': COMMERCE_CART_SOURCE,
    'commerce-checkout': COMMERCE_CHECKOUT_SOURCE,
    'commerce-stock': COMMERCE_STOCK_SOURCE,
    'commerce-payment': COMMERCE_PAYMENT_SOURCE,
    'commerce-refund': COMMERCE_REFUND_SOURCE,
    'commerce-fulfillment': COMMERCE_FULFILLMENT_SOURCE,
    'commerce-execution': COMMERCE_EXECUTION_SOURCE,
    'payment-gateway': COMMERCE_GATEWAY_SOURCE
  }
  return [
    ...Object.entries(sources).map(([name, content]) =>
      nestJSArtifact('src/' + name + '.ts', content)
    ),
    nestJSArtifact('COMMERCE.md', COMMERCE_GUIDE)
  ]
}
