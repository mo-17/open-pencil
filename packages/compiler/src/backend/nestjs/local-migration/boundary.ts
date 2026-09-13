import { digestCanonicalBackendValue } from '#compiler/backend/canonical'

import type {
  BackendApplicationSpecV1,
  BackendDiagnostic,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

export function localMigrationDiagnostic(
  code: string,
  path: string,
  message: string
): BackendDiagnostic {
  return { code: 'backend-local-migration-' + code, severity: 'error', path, message }
}

function relationNames(entity: DataEntityIR): string[] {
  return [entity.name, entity.name + '_pkey', entity.name + '_owner_page_idx']
}

/** Reject SQL name swaps/reuse rather than synthesizing temporary names or guessing identity. */
function nameCollisions(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1
): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  const relations = new Map(
    from.dataModel.entities.flatMap((entity) =>
      relationNames(entity).map((name, kind) => [name, { entityId: entity.id, kind }] as const)
    )
  )
  for (const entity of to.dataModel.entities) {
    if (
      relationNames(entity).some((name, kind) => {
        const current = relations.get(name)
        return current !== undefined && (current.entityId !== entity.id || current.kind !== kind)
      })
    ) {
      diagnostics.push(
        localMigrationDiagnostic(
          'name-reuse-unsupported',
          '$.toApplication.dataModel.entities',
          'A target table or generated index reuses another existing relation name. Name swaps require a separately reviewed migration.'
        )
      )
    }
    const current = from.dataModel.entities.find((entry) => entry.id === entity.id)
    if (!current) continue
    const names = new Map(current.fields.map((field) => [field.name, field.id]))
    if (
      entity.fields.some((field) => names.has(field.name) && names.get(field.name) !== field.id)
    ) {
      diagnostics.push(
        localMigrationDiagnostic(
          'name-reuse-unsupported',
          '$.toApplication.dataModel.entities',
          'A target column reuses another existing stable field ID name. Column name swaps require a separately reviewed migration.'
        )
      )
    }
  }
  return diagnostics
}

export function validateLocalMigrationBoundary(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1
): BackendDiagnostic[] {
  const diagnostics = nameCollisions(from, to)
  const hadCommands = (from.commands?.commands.length ?? 0) > 0
  const hasCommands = (to.commands?.commands.length ?? 0) > 0
  if (hadCommands !== hasCommands) {
    diagnostics.push(
      localMigrationDiagnostic(
        'command-ledger-change-blocked',
        '$.toApplication.commands',
        'Adding or removing the internal command ledger requires a separately reviewed schema migration. Existing data and idempotency records are preserved; a fresh example may be initialized in its own database.'
      )
    )
  }
  const advanced = [from, to].some(
    ({ dataModel, commands }) =>
      (commands?.commands.length ?? 0) > 0 ||
      dataModel.enums.length > 0 ||
      dataModel.relations.length > 0 ||
      dataModel.entities.some(
        (entity) =>
          (entity.foreignKeys?.length ?? 0) > 0 ||
          (entity.uniques?.length ?? 0) > 0 ||
          (entity.indexes?.length ?? 0) > 0
      )
  )
  if (
    advanced &&
    digestCanonicalBackendValue(from.dataModel, '$.from.model') !==
      digestCanonicalBackendValue(to.dataModel, '$.to.model')
  ) {
    diagnostics.push(
      localMigrationDiagnostic(
        'relational-schema-change-blocked',
        '$.toApplication.dataModel',
        'Models with enums, authored indexes, unique constraints or foreign-key relations currently support fresh initialization and runtime rebuilds only. Existing data is preserved; schema changes require a separately reviewed migration.'
      )
    )
  }
  if (from.applicationId !== to.applicationId) {
    diagnostics.push(
      localMigrationDiagnostic(
        'application-mismatch',
        '$.toApplication.applicationId',
        'Local preview migration cannot adopt a different application database.'
      )
    )
  }
  for (const entity of from.dataModel.entities) {
    const target = to.dataModel.entities.find((entry) => entry.id === entity.id)
    if (!target) continue // The shared diff reports the blocked table drop.
    const currentOwner = from.auth.ownership.find((entry) => entry.entityId === entity.id)
    const targetOwner = to.auth.ownership.find((entry) => entry.entityId === entity.id)
    if (
      digestCanonicalBackendValue(currentOwner, '$.from.owner') !==
      digestCanonicalBackendValue(targetOwner, '$.to.owner')
    ) {
      diagnostics.push(
        localMigrationDiagnostic(
          'ownership-change-blocked',
          '$.toApplication.auth.ownership',
          'Changing an existing table owner binding requires a separately reviewed data migration.'
        )
      )
    }
  }
  return diagnostics
}
