import type { AuthPolicyIR, DataEntityIR, DataFieldIR, DataModelIR } from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import { validateCommerceRelationships } from './relationships'
import { COMMERCE_ENUMS, commerceEntityFields } from './schema'
import { COMMERCE_ENTITY_KEYS, commerceError } from './shape'
import type { BackendCommerceEntitiesIR, BackendCommerceIRV1 } from './types'

function sameDefault(actual: DataFieldIR['default'], expected: DataFieldIR['default']): boolean {
  if (!actual || !expected) return actual === expected
  return actual.kind === 'literal' && expected.kind === 'literal'
    ? actual.value === expected.value
    : actual.kind === 'generated' &&
        expected.kind === 'generated' &&
        actual.generator === expected.generator
}

function requireUnique(
  entity: DataEntityIR,
  fields: string[],
  context: BackendValidationContext
): void {
  if (
    !entity.uniques?.some(
      (unique) =>
        unique.fields.length === fields.length &&
        fields.every((field) => unique.fields.includes(field))
    )
  ) {
    commerceError(
      context,
      '$.commerce.entities.' + entity.id,
      'Commerce requires a unique constraint on ' + fields.join(', ') + '.'
    )
  }
}

function validateEntity(
  entity: DataEntityIR,
  key: keyof BackendCommerceEntitiesIR,
  auth: AuthPolicyIR,
  commerce: BackendCommerceIRV1,
  context: BackendValidationContext
): void {
  const path = '$.commerce.entities.' + key
  for (const expected of commerceEntityFields(key)) {
    const actual = entity.fields.find((entry) => entry.id === expected.id)
    if (
      !actual ||
      actual.type !== expected.type ||
      actual.nullable !== expected.nullable ||
      actual.enumId !== expected.enumId ||
      !sameDefault(actual.default, expected.default)
    )
      commerceError(
        context,
        path + '.' + expected.id,
        'Commerce fields must preserve the fixed scalar, nullability and default contract.'
      )
  }
  const ownership = auth.ownership.filter((entry) => entry.entityId === entity.id)
  if (ownership.length !== 1 || ownership[0].identityFieldId !== 'owner_id')
    commerceError(
      context,
      path,
      'Each commerce entity requires exactly one owner_id ownership declaration.'
    )
  if (
    entity.foreignKeys?.some(
      (foreignKey) => !['restrict', 'no-action'].includes(foreignKey.onDelete)
    )
  )
    commerceError(context, path, 'Commerce foreign keys cannot cascade or null business history.')
  const uniqueFields: Partial<Record<keyof BackendCommerceEntitiesIR, string[]>> = {
    stores: ['owner_id'],
    carts: ['owner_id'],
    cartItems: ['cart_id', 'sku_id'],
    refunds: ['order_id'],
    shipments: ['order_id'],
    settlements: ['order_id'],
    orders: ['payment_group_id', 'store_id'],
    orderItems: ['order_id', 'sku_id']
  }
  const fields = uniqueFields[key]
  requireUnique(entity, ['id', 'owner_id'], context)
  if (fields) requireUnique(entity, fields, context)
  if (key === 'stores' && commerce.mode === 'single-merchant')
    requireUnique(entity, ['single_store'], context)
}

/** Runtime SQL relies on these semantic IDs and exact scalar/default contracts. */
export function validateCommerceModel(
  commerce: BackendCommerceIRV1,
  model: DataModelIR,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): void {
  for (const role of Object.values(commerce.roles)) {
    if (!auth.roles.some((entry) => entry.id === role))
      commerceError(
        context,
        '$.commerce.roles',
        'Commerce roles must reference declared authentication roles.'
      )
  }
  for (const [enumId, values] of Object.entries(COMMERCE_ENUMS)) {
    const actual = model.enums.find((entry) => entry.id === enumId)
    if (
      !actual ||
      actual.values.length !== values.length ||
      values.some((value) => !actual.values.includes(value))
    )
      commerceError(context, '$.commerce', 'Commerce status enums must retain their closed values.')
  }
  for (const key of COMMERCE_ENTITY_KEYS) {
    const entity = model.entities.find((entry) => entry.id === commerce.entities[key])
    const path = '$.commerce.entities.' + key
    if (
      entity?.management !== 'managed' ||
      entity.primaryKey?.fields.length !== 1 ||
      entity.primaryKey.fields[0] !== 'id'
    ) {
      commerceError(
        context,
        path,
        'Commerce requires managed entities with the fixed id primary key.'
      )
      continue
    }
    validateEntity(entity, key, auth, commerce, context)
    validateCommerceRelationships(entity, key, commerce.entities, context)
  }
}
