import {
  commerceCommandDefinitions,
  deriveBackendApplicationCapabilities
} from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1
} from '@open-pencil/lowcode/backend'

import { createNestJSNotesApplication } from '@/app/lowcode/backend/nestjs-draft'

import { assertCommerceMerchantMode, type CommerceMerchantMode } from '../merchant/types'
import { createCommerceOperationEntities, linkCommerceOperationEntities } from './model/entities'
import { configureCommerceOperationPermissions } from './model/permissions'
import { configureCommerceOperationResources } from './model/resources'

/** Full commerce is a new template contract; existing starter documents are never upgraded implicitly. */
export function createCommerceOperationsApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1,
  mode: CommerceMerchantMode,
  commissionBasisPoints = 0
): BackendApplicationSpecV1 {
  assertCommerceMerchantMode(mode)
  if (
    !Number.isInteger(commissionBasisPoints) ||
    commissionBasisPoints < 0 ||
    commissionBasisPoints > 10_000
  )
    throw new Error('Commission must be an integer number of basis points from 0 to 10000.')
  const application = createNestJSNotesApplication(applicationId)
  const browser = application.httpApi?.browserClient
  if (!browser) throw new Error('Commerce requires a browser login configuration.')
  browser.authentication = structuredClone(authentication)
  const entities = createCommerceOperationEntities(application)
  linkCommerceOperationEntities(entities, mode === 'single-merchant')
  configureCommerceOperationPermissions(application, entities)
  configureCommerceOperationResources(application, entities)
  application.commerce = {
    version: 1,
    mode,
    currency: 'CNY',
    commissionBasisPoints,
    maxItems: 50,
    maxStores: mode === 'single-merchant' ? 1 : 10,
    reservationSeconds: 1800,
    settlementDelaySeconds: 7 * 24 * 60 * 60,
    entities: {
      stores: entities.stores.id,
      products: entities.products.id,
      carts: entities.carts.id,
      cartItems: entities.cartItems.id,
      paymentGroups: entities.paymentGroups.id,
      orders: entities.orders.id,
      orderItems: entities.orderItems.id,
      refunds: entities.refunds.id,
      shipments: entities.shipments.id,
      settlements: entities.settlements.id
    },
    roles: { merchant: 'merchant', operator: 'commerce-operator' }
  }
  application.commands = { version: 1, commands: commerceCommandDefinitions(application) }
  application.capabilities = deriveBackendApplicationCapabilities(application).map(
    (capability) => ({ capability, required: true })
  )
  return application
}
