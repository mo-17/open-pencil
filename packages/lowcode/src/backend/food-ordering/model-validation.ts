import type { AuthPolicyIR, DataEntityIR, DataModelIR } from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import {
  FOOD_ORDERING_ENUMS,
  foodOrderingEntityFields,
  foodOrderingEntityForeignKeys
} from './schema'
import { foodOrderingError } from './shape'
import {
  FOOD_ORDERING_ENTITY_KEYS,
  type BackendFoodOrderingEntitiesIR,
  type BackendFoodOrderingIRV1
} from './types'

function validateEntity(
  entity: DataEntityIR,
  key: keyof BackendFoodOrderingEntitiesIR,
  profile: BackendFoodOrderingIRV1,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): void {
  const path = '$.foodOrdering.entities.' + key
  const fields = foodOrderingEntityFields(key)
  const expected = fields.map(({ name: _name, ...field }) => field)
  const actual = entity.fields.map(({ name: _name, ...field }) => field)
  const scalarContract = (values: typeof actual) =>
    JSON.stringify(
      values
        .sort((a, b) => a.id.localeCompare(b.id, 'en'))
        .map((field) => [
          field.id,
          field.type,
          field.nullable,
          field.enumId ?? null,
          field.default?.kind ?? null,
          field.default?.kind === 'literal'
            ? field.default.value
            : (field.default?.generator ?? null)
        ])
    )
  if (scalarContract(actual) !== scalarContract(expected))
    foodOrderingError(
      context,
      path,
      'Food ordering fields must retain their exact types, defaults and required columns.'
    )
  const ownership = auth.ownership.filter((entry) => entry.entityId === entity.id)
  if (ownership.length !== 1 || ownership[0].identityFieldId !== 'owner_id')
    foodOrderingError(context, path, 'Food records require one owner_id ownership declaration.')
  const uniqueSets = [['id', 'owner_id']]
  if (key === 'carts') uniqueSets.push(['owner_id'])
  if (key === 'cartItems') uniqueSets.push(['cart_id', 'menu_item_id'])
  if (key === 'orderItems') uniqueSets.push(['order_id', 'menu_item_id'])
  for (const fields of uniqueSets)
    if (
      !entity.uniques?.some(
        (entry) =>
          entry.fields.length === fields.length &&
          fields.every((field) => entry.fields.includes(field))
      )
    )
      foodOrderingError(context, path, 'Missing required food record uniqueness constraint.')
  const relationships = foodOrderingEntityForeignKeys(key, profile.entities)
  const actualRelationships = entity.foreignKeys ?? []
  if (
    relationships.length !== actualRelationships.length ||
    relationships.some(
      (expected) =>
        !actualRelationships.some(
          (entry) =>
            entry.targetEntityId === expected.targetEntityId &&
            ['restrict', 'no-action'].includes(entry.onDelete) &&
            JSON.stringify(entry.fields) === JSON.stringify(expected.fields) &&
            JSON.stringify(entry.targetFields) === JSON.stringify(expected.targetFields)
        )
    )
  )
    foodOrderingError(
      context,
      path,
      'Food references must retain exact composite owner keys without cascading history.'
    )
}

export function validateFoodOrderingModel(
  profile: BackendFoodOrderingIRV1,
  model: DataModelIR,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): void {
  if (!auth.roles.some((role) => role.id === profile.managerRoleId))
    foodOrderingError(
      context,
      '$.foodOrdering.managerRoleId',
      'The restaurant manager role must be declared.'
    )
  for (const [id, values] of Object.entries(FOOD_ORDERING_ENUMS)) {
    const found = model.enums.find((entry) => entry.id === id)
    if (
      !found ||
      found.values.length !== values.length ||
      values.some((value) => !found.values.includes(value))
    )
      foodOrderingError(
        context,
        '$.foodOrdering',
        'Food status and fulfillment enums must preserve their closed values.'
      )
  }
  for (const key of FOOD_ORDERING_ENTITY_KEYS) {
    const entity = model.entities.find((entry) => entry.id === profile.entities[key])
    if (
      entity?.management !== 'managed' ||
      entity.primaryKey?.fields.length !== 1 ||
      entity.primaryKey.fields[0] !== 'id'
    ) {
      foodOrderingError(
        context,
        '$.foodOrdering.entities.' + key,
        'Food ordering requires managed records with the id primary key.'
      )
      continue
    }
    validateEntity(entity, key, profile, auth, context)
  }
}
