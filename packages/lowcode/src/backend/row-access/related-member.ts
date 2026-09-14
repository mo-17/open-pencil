import type {
  AuthRelatedMemberPrincipalIR,
  AuthRowAccessIntentIR,
  DataEntityIR,
  DataModelIR
} from '../types'
import {
  diagnostic,
  id,
  type BackendUnknownRecord,
  type BackendValidationContext
} from '../validation-helpers'
import { parseAuthConditions, validateAuthConditions } from './conditions'

export function parseRelatedMember(
  source: BackendUnknownRecord,
  path: string,
  context: BackendValidationContext
): AuthRelatedMemberPrincipalIR | undefined {
  const entityFieldId = id(source.entityFieldId, path + '.entityFieldId', context)
  const membershipEntityId = id(source.membershipEntityId, path + '.membershipEntityId', context)
  const membershipFieldId = id(source.membershipFieldId, path + '.membershipFieldId', context)
  const identityFieldId = id(source.identityFieldId, path + '.identityFieldId', context)
  const roleId =
    source.roleId === undefined ? undefined : id(source.roleId, path + '.roleId', context)
  const conditions =
    source.conditions === undefined
      ? undefined
      : parseAuthConditions(source.conditions, path + '.conditions', context)
  return entityFieldId &&
    membershipEntityId &&
    membershipFieldId &&
    identityFieldId &&
    (source.roleId === undefined || roleId) &&
    (source.conditions === undefined || conditions)
    ? {
        kind: 'related-member',
        entityFieldId,
        membershipEntityId,
        membershipFieldId,
        identityFieldId,
        ...(roleId ? { roleId } : {}),
        ...(conditions ? { conditions } : {})
      }
    : undefined
}

function anchors(entity: DataEntityIR, fieldId: string): string[] {
  return [
    entity.id + ':' + fieldId,
    ...(entity.foreignKeys ?? []).flatMap((foreignKey) =>
      foreignKey.fields.flatMap((id, index) =>
        id === fieldId ? [foreignKey.targetEntityId + ':' + foreignKey.targetFields[index]] : []
      )
    )
  ]
}

export function validateRelatedMemberPolicy(
  policy: AuthRowAccessIntentIR,
  model: DataModelIR,
  context: BackendValidationContext
): void {
  const entity = model.entities.find((entry) => entry.id === policy.entityId)
  const path = '$.auth.rowAccess.' + policy.id
  validateAuthConditions(policy.conditions, entity, model, path + '.conditions', context)
  if (
    (policy.conditions || policy.principal.kind === 'related-member') &&
    (policy.effect !== 'allow' || policy.operations.some((operation) => operation !== 'select'))
  )
    diagnostic(
      context,
      'backend-auth-condition-invalid',
      path,
      'Conditional and related-member policies support allow/select only; writes require explicit commands.'
    )
  const principal = policy.principal
  if (principal.kind !== 'related-member') return
  const membership = model.entities.find((entry) => entry.id === principal.membershipEntityId)
  if (!validMembershipFields(entity, membership, principal))
    diagnostic(
      context,
      'backend-auth-membership-invalid',
      path,
      'Related membership requires non-null UUID identity and linked UUID fields sharing a declared foreign-key anchor.'
    )
  if (
    membership &&
    ![membership.primaryKey, ...(membership.uniques ?? [])].some(
      (key) =>
        (key?.fields.length === 1 && key.fields[0] === principal.membershipFieldId) ||
        (key?.fields.length === 2 &&
          key.fields.includes(principal.membershipFieldId) &&
          key.fields.includes(principal.identityFieldId))
    )
  )
    diagnostic(
      context,
      'backend-auth-membership-invalid',
      path,
      'Membership requires a unique locator or a unique locator/identity pair.'
    )
  validateAuthConditions(
    principal.conditions,
    membership,
    model,
    path + '.principal.conditions',
    context
  )
}

/** HTTP cannot directly create, rebind, or reactivate membership authority. */
export function relatedMemberProtectedFields(
  policies: readonly AuthRowAccessIntentIR[],
  entityId: string
): Set<string> {
  const fields = new Set<string>()
  for (const policy of policies) {
    const principal = policy.principal
    if (principal.kind !== 'related-member') continue
    if (policy.entityId === entityId) fields.add(principal.entityFieldId)
    if (principal.membershipEntityId === entityId) {
      fields.add(principal.membershipFieldId)
      fields.add(principal.identityFieldId)
      for (const condition of principal.conditions ?? []) fields.add(condition.fieldId)
    }
  }
  return fields
}

function validMembershipFields(
  entity: DataEntityIR | undefined,
  membership: DataEntityIR | undefined,
  principal: AuthRelatedMemberPrincipalIR
): boolean {
  const field = entity?.fields.find((entry) => entry.id === principal.entityFieldId)
  const membershipField = membership?.fields.find(
    (entry) => entry.id === principal.membershipFieldId
  )
  const identity = membership?.fields.find((entry) => entry.id === principal.identityFieldId)
  return !(
    !entity ||
    !membership ||
    entity.management !== 'managed' ||
    membership.management !== 'managed' ||
    !field ||
    !membershipField ||
    !identity ||
    [field, membershipField, identity].some((entry) => entry.type !== 'uuid' || entry.nullable) ||
    identity.id === membershipField.id ||
    !anchors(entity, field.id).some((anchor) =>
      anchors(membership, membershipField.id).includes(anchor)
    )
  )
}
