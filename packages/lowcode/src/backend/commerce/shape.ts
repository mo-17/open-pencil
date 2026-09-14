import { commandInteger } from '../commands/shape-values'
import {
  diagnostic,
  id,
  oneOf,
  record,
  uniqueBy,
  type BackendValidationContext
} from '../validation-helpers'
import {
  BACKEND_COMMERCE_IR_VERSION,
  type BackendCommerceEntitiesIR,
  type BackendCommerceIRV1
} from './types'

export const COMMERCE_ENTITY_KEYS = [
  'stores',
  'products',
  'carts',
  'cartItems',
  'paymentGroups',
  'orders',
  'orderItems',
  'refunds',
  'shipments',
  'settlements'
] as const satisfies readonly (keyof BackendCommerceEntitiesIR)[]

export function commerceError(
  context: BackendValidationContext,
  path: string,
  message: string
): void {
  diagnostic(context, 'backend-commerce-invalid', path, message)
}

export function parseBackendCommerceIRV1(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendCommerceIRV1 | undefined {
  const source = record(value, path, context, [
    'version',
    'mode',
    'currency',
    'commissionBasisPoints',
    'maxItems',
    'maxStores',
    'reservationSeconds',
    'settlementDelaySeconds',
    'entities',
    'roles'
  ])
  if (!source) return undefined
  if (source.version !== BACKEND_COMMERCE_IR_VERSION)
    commerceError(context, path + '.version', 'Unsupported commerce contract version.')
  const mode = oneOf(source.mode, path + '.mode', context, ['single-merchant', 'multi-merchant'])
  const currency = oneOf(source.currency, path + '.currency', context, ['CNY', 'USD'])
  const commissionBasisPoints = commandInteger(
    source.commissionBasisPoints,
    path + '.commissionBasisPoints',
    context,
    0,
    10000
  )
  const maxItems = commandInteger(source.maxItems, path + '.maxItems', context, 1, 50)
  const maxStores = commandInteger(source.maxStores, path + '.maxStores', context, 1, 10)
  const reservationSeconds = commandInteger(
    source.reservationSeconds,
    path + '.reservationSeconds',
    context,
    60,
    86400
  )
  const settlementDelaySeconds = commandInteger(
    source.settlementDelaySeconds,
    path + '.settlementDelaySeconds',
    context,
    0,
    7776000
  )
  const rawEntities = record(source.entities, path + '.entities', context, COMMERCE_ENTITY_KEYS)
  const rawRoles = record(source.roles, path + '.roles', context, ['merchant', 'operator'])
  if (!rawEntities || !rawRoles) return undefined
  const entities = {} as BackendCommerceEntitiesIR
  for (const key of COMMERCE_ENTITY_KEYS) {
    const entityId = id(rawEntities[key], path + '.entities.' + key, context)
    if (!entityId) return undefined
    entities[key] = entityId
  }
  uniqueBy(Object.values(entities), path + '.entities', context, 'commerce entity')
  const merchant = id(rawRoles.merchant, path + '.roles.merchant', context)
  const operator = id(rawRoles.operator, path + '.roles.operator', context)
  if (
    !mode ||
    !currency ||
    commissionBasisPoints === undefined ||
    maxItems === undefined ||
    maxStores === undefined ||
    reservationSeconds === undefined ||
    settlementDelaySeconds === undefined ||
    !merchant ||
    !operator
  )
    return undefined
  if (merchant === operator)
    commerceError(
      context,
      path + '.roles',
      'Merchant and platform operator roles must be distinct.'
    )
  if (maxStores > maxItems || (mode === 'single-merchant' && maxStores !== 1))
    commerceError(
      context,
      path + '.maxStores',
      'Store bounds must fit the item limit and single-merchant mode requires one store.'
    )
  return {
    version: BACKEND_COMMERCE_IR_VERSION,
    mode,
    currency,
    commissionBasisPoints,
    maxItems,
    maxStores,
    reservationSeconds,
    settlementDelaySeconds,
    entities,
    roles: { merchant, operator }
  }
}
