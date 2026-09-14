import type { BackendApplicationSpecV1, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import { nestJSDiagnostic } from './model'
import { nestJSRelationNames } from './schema-names'

function publicRead(
  application: BackendApplicationSpecV1,
  entityId: string,
  targetFields: readonly string[]
): boolean {
  const projected = application.httpApi?.resources.some(
    (resource) =>
      resource.entityId === entityId &&
      resource.operations.some((operation) => ['list', 'read'].includes(operation)) &&
      targetFields.every((field) => resource.readFields.includes(field)) &&
      application.auth.rowAccess.some(
        (policy) =>
          policy.entityId === entityId &&
          policy.effect === 'allow' &&
          policy.principal.kind === 'anonymous' &&
          policy.conditions === undefined &&
          policy.operations.includes('select') &&
          (!resource.readPolicyIds || resource.readPolicyIds.includes(policy.id))
      )
  )
  return (
    Boolean(projected) &&
    application.auth.rowAccess.some(
      (policy) =>
        policy.entityId === entityId &&
        policy.effect === 'allow' &&
        policy.principal.kind === 'anonymous' &&
        policy.conditions === undefined &&
        policy.operations.includes('select')
    )
  )
}

/** Shared IR validates field types, uniqueness, references and relation cardinality first. */
export function nestJSConstraintDiagnostics(application: BackendApplicationSpecV1) {
  const diagnostics: BackendDiagnostic[] = []
  for (const entity of application.dataModel.entities) {
    for (const foreignKey of entity.foreignKeys ?? []) {
      const path = '$.application.dataModel.entities.' + entity.id + '.foreignKeys.' + foreignKey.id
      if (!['restrict', 'no-action'].includes(foreignKey.onDelete)) {
        diagnostics.push(
          nestJSDiagnostic(
            path,
            'NestJS foreign keys support only restrict or no-action deletion. Cascading writes and set-null require separately authorized related-row mutations.'
          )
        )
      }
      const sourceOwner = application.auth.ownership.find((entry) => entry.entityId === entity.id)
      const targetOwner = application.auth.ownership.find(
        (entry) => entry.entityId === foreignKey.targetEntityId
      )
      const ownerIndex = sourceOwner ? foreignKey.fields.indexOf(sourceOwner.identityFieldId) : -1
      const sameOwner =
        ownerIndex >= 0 &&
        foreignKey.targetFields.indexOf(targetOwner?.identityFieldId ?? '') === ownerIndex
      if (
        !sameOwner &&
        !publicRead(application, foreignKey.targetEntityId, foreignKey.targetFields)
      ) {
        diagnostics.push(
          nestJSDiagnostic(
            path,
            'A NestJS foreign key must include matching source and target owner fields or reference fields explicitly exposed by a public-readable HTTP resource. A record ID alone does not authorize cross-owner references.'
          )
        )
      }
    }
  }
  return diagnostics
}

export function nestJSNameDiagnostics(application: BackendApplicationSpecV1) {
  const names = application.dataModel.entities.flatMap(nestJSRelationNames)
  // Enums and table row types share pg_type; reserve the stricter combined namespace.
  names.push(...application.dataModel.enums.map((entry) => entry.name))
  if (new Set(names).size === names.length) return []
  return [
    nestJSDiagnostic(
      '$.application.dataModel.entities',
      'NestJS tables, enum types and generated index relation names must be distinct within public.'
    )
  ]
}
