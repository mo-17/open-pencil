// Supabase deployment-domain inspector tests.
import { describe, expect, test } from 'bun:test'

import { formatSupabaseManagedMarker } from '@open-pencil/compiler/backend'

import {
  SUPABASE_PG_CATALOG_FIXED_QUERIES,
  SUPABASE_PG_CATALOG_QUERY_IDS,
  SUPABASE_PG_CATALOG_QUERY_VERSION,
  SupabasePgCatalogInspectionError,
  inspectSupabasePgCatalog,
  type SupabasePgCatalogHostTransport,
  type SupabasePgCatalogProjectAuthority,
  type SupabasePgCatalogReadRequest,
  type SupabasePgCatalogReadResult
} from '@/app/plugins/host/deployment/supabase/pg-catalog-inspector'

const PROJECT_REF = 'project-ref-1'
const ACCOUNT_ID = 'organization-1'
const GRANT_GENERATION = 'grant-1'
const NOW = '2026-08-30T12:00:00.000Z'
const SNAPSHOT_MARKER = '100:200:'
const SECRET = 'sb_secret_must_never_escape'

function projectAuthority(
  overrides: Partial<SupabasePgCatalogProjectAuthority> = {}
): SupabasePgCatalogProjectAuthority {
  return {
    projectRef: PROJECT_REF,
    organizationId: ACCOUNT_ID,
    grantGeneration: GRANT_GENERATION,
    ...overrides
  }
}

function provenanceRow(serverVersionNum = '170000') {
  return {
    databaseOid: '5',
    databaseName: 'postgres',
    schemaOid: '2200',
    schemaName: 'public',
    currentRoleOid: '10',
    currentRoleName: 'postgres',
    serverVersionNum,
    snapshotMarker: SNAPSHOT_MARKER,
    observedAt: NOW,
    columnPrivilegesPresent: false
  }
}

function roleRows() {
  return [
    {
      roleOid: '10',
      roleName: 'postgres',
      superuser: true,
      bypassRls: true,
      inherit: true
    },
    {
      roleOid: '11',
      roleName: 'anon',
      superuser: false,
      bypassRls: false,
      inherit: true
    },
    {
      roleOid: '12',
      roleName: 'authenticated',
      superuser: false,
      bypassRls: false,
      inherit: true
    }
  ]
}

function defaultRows(queryId: (typeof SUPABASE_PG_CATALOG_QUERY_IDS)[number]) {
  if (queryId === 'provenance') return [provenanceRow()]
  if (queryId === 'roles') return roleRows()
  return []
}

function readResult(
  rows: Partial<Record<(typeof SUPABASE_PG_CATALOG_QUERY_IDS)[number], readonly unknown[]>> = {}
): SupabasePgCatalogReadResult {
  return {
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    grantGeneration: GRANT_GENERATION,
    queryVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
    schema: 'public',
    snapshotScope: 'single-statement',
    accessMode: 'read-only',
    snapshotMarker: SNAPSHOT_MARKER,
    observedAt: NOW,
    results: SUPABASE_PG_CATALOG_QUERY_IDS.map((queryId) => ({
      queryId,
      snapshotMarker: SNAPSHOT_MARKER,
      complete: true,
      truncated: false,
      rows: rows[queryId] ?? defaultRows(queryId)
    }))
  }
}

function transport(
  options: {
    authority?: SupabasePgCatalogProjectAuthority
    result?: SupabasePgCatalogReadResult
    onRead?: (request: SupabasePgCatalogReadRequest) => void
  } = {}
): SupabasePgCatalogHostTransport {
  return {
    async getProjectAuthority() {
      return options.authority ?? projectAuthority()
    },
    async runReadOnlyCatalogQueries(request) {
      options.onRead?.(request)
      return options.result ?? readResult()
    }
  }
}

function inspect(using: SupabasePgCatalogHostTransport) {
  return inspectSupabasePgCatalog({
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    grantGeneration: GRANT_GENERATION,
    transport: using
  })
}

function diagnosticCode(error: unknown): string | undefined {
  return error instanceof SupabasePgCatalogInspectionError ? error.diagnostics[0]?.code : undefined
}

async function expectDiagnostic(
  promise: Promise<unknown>,
  code: string
): Promise<SupabasePgCatalogInspectionError> {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(SupabasePgCatalogInspectionError)
  expect(diagnosticCode(caught)).toBe(code)
  return caught as SupabasePgCatalogInspectionError
}

describe('Supabase fixed read-only pg_catalog inspector', () => {
  test('uses only the complete fixed query whitelist and emits a strict empty baseline', async () => {
    let captured!: SupabasePgCatalogReadRequest
    const snapshot = await inspect(
      transport({
        onRead(request) {
          captured = request
        }
      })
    )

    expect(SUPABASE_PG_CATALOG_FIXED_QUERIES.map(({ queryId }) => queryId)).toEqual(
      SUPABASE_PG_CATALOG_QUERY_IDS
    )
    for (const definition of SUPABASE_PG_CATALOG_FIXED_QUERIES) {
      expect(definition.parameterOrder).toEqual(['schema', 'rowLimit'])
      expect(definition.sql).toMatch(/^(?:SELECT|WITH)\b/u)
      expect(definition.sql).toContain('$1')
      expect(definition.sql).toContain('$2')
      expect(definition.sql).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|COPY|CALL|DO)\b/u
      )
    }
    expect(
      SUPABASE_PG_CATALOG_FIXED_QUERIES.find(({ queryId }) => queryId === 'objects')?.sql
    ).toContain('pg_catalog.pg_options_to_table(c.reloptions)')
    expect(
      SUPABASE_PG_CATALOG_FIXED_QUERIES.find(({ queryId }) => queryId === 'objects')?.sql
    ).toContain('reloption.option_value::boolean')
    expect(
      SUPABASE_PG_CATALOG_FIXED_QUERIES.find(({ queryId }) => queryId === 'columns')?.sql
    ).toContain('a.attacl IS NOT NULL AS "columnPrivilegesPresent"')
    const provenanceSql = SUPABASE_PG_CATALOG_FIXED_QUERIES.find(
      ({ queryId }) => queryId === 'provenance'
    )?.sql
    expect(provenanceSql).toContain('EXISTS (')
    expect(provenanceSql).toContain("acl_relation.relkind IN ('r', 'p', 'v', 'm')")
    expect(provenanceSql).toContain('acl_attribute.attnum > 0')
    expect(provenanceSql).toContain('NOT acl_attribute.attisdropped')
    expect(provenanceSql).toContain('acl_attribute.attacl IS NOT NULL')
    const defaultPrivilegeSql = SUPABASE_PG_CATALOG_FIXED_QUERIES.find(
      ({ queryId }) => queryId === 'default-privileges'
    )?.sql
    const privilegeSql = SUPABASE_PG_CATALOG_FIXED_QUERIES.find(
      ({ queryId }) => queryId === 'privileges'
    )?.sql
    expect(privilegeSql).toContain('acl.grantee <> object_acls.owner_oid')
    expect(defaultPrivilegeSql).toContain('owner.rolname = current_user')
    expect(defaultPrivilegeSql).toContain('acl.grantee <> defaults.defaclrole')
    expect(captured?.queries.map(({ queryId }) => queryId)).toEqual(SUPABASE_PG_CATALOG_QUERY_IDS)
    expect(captured?.queries.every((query) => !Object.hasOwn(query, 'sql'))).toBe(true)
    expect(captured).toMatchObject({
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION,
      queryVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
      schema: 'public',
      snapshotScope: 'single-statement',
      accessMode: 'read-only'
    })
    expect(JSON.stringify(captured)).not.toContain(SECRET)
    expect(snapshot.provenance).toMatchObject({
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      querySchemaVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
      databaseRole: 'postgres',
      completeness: 'complete',
      truncated: false
    })
    expect(snapshot.currentModel).toEqual({ version: 1, entities: [], enums: [], relations: [] })
    expect(snapshot.roles).toHaveLength(3)
    expect(snapshot.roles).toContainEqual({
      roleName: 'postgres',
      superuser: true,
      bypassRls: true,
      inherit: true
    })
    expect(snapshot.roleMemberships).toEqual([])
    expect(snapshot.objects).toEqual([])
  })

  test('records exact security-invoker evidence for public views', async () => {
    const snapshot = await inspect(
      transport({
        result: readResult({
          objects: [
            {
              classOid: '1259',
              objectOid: '16384',
              subId: 0,
              schemaOid: '2200',
              schemaName: 'public',
              kind: 'view',
              objectName: 'safe_notes',
              rlsEnabled: null,
              rlsForced: null,
              securityInvoker: true,
              securityDefiner: null,
              enumValues: null,
              marker: null
            }
          ]
        })
      })
    )

    expect(snapshot.objects).toEqual([
      {
        kind: 'view',
        schema: 'public',
        name: 'safe_notes',
        management: 'external',
        securityInvoker: true
      }
    ])
  })

  test('rejects truncated and over-limit query results before parsing rows', async () => {
    const truncated = structuredClone(readResult())
    const policies = truncated.results.find((result) => result.queryId === 'policies')
    Reflect.set(policies ?? {}, 'truncated', true)
    await expectDiagnostic(
      inspect(transport({ result: truncated })),
      'supabase-pg-catalog-query-truncated'
    )

    const maximumPolicies = SUPABASE_PG_CATALOG_FIXED_QUERIES.find(
      ({ queryId }) => queryId === 'policies'
    )?.maximumRows
    if (!maximumPolicies) throw new Error('Missing policies query definition')
    const oversized = readResult({ policies: Array.from({ length: maximumPolicies + 1 }) })
    await expectDiagnostic(
      inspect(transport({ result: oversized })),
      'supabase-pg-catalog-query-row-limit-exceeded'
    )
  })

  test('rejects query-envelope tampering and foreign project authority', async () => {
    const tampered = structuredClone(readResult())
    Reflect.set(tampered, 'queryVersion', 'attacker-query-v2')
    await expectDiagnostic(
      inspect(transport({ result: tampered })),
      'supabase-pg-catalog-query-envelope-invalid'
    )

    const injected = structuredClone(readResult())
    Reflect.set(injected, 'credential', SECRET)
    const injectedError = await expectDiagnostic(
      inspect(transport({ result: injected })),
      'supabase-pg-catalog-query-envelope-invalid'
    )
    expect(injectedError.message).not.toContain(SECRET)

    await expectDiagnostic(
      inspect(transport({ authority: projectAuthority({ projectRef: 'foreign-project' }) })),
      'supabase-pg-catalog-project-authority-mismatch'
    )

    await expectDiagnostic(
      inspect(
        transport({ authority: projectAuthority({ organizationId: 'foreign-organization' }) })
      ),
      'supabase-pg-catalog-project-authority-mismatch'
    )
  })

  test('fails closed for PG15 membership evidence and malformed managed markers', async () => {
    await expectDiagnostic(
      inspect(transport({ result: readResult({ provenance: [provenanceRow('150000')] }) })),
      'supabase-pg-catalog-query-version-unsupported'
    )

    const markerSecret = `openpencil:${SECRET}`
    const object = {
      classOid: '1259',
      objectOid: '16384',
      subId: 0,
      schemaOid: '2200',
      schemaName: 'public',
      kind: 'table',
      objectName: 'notes',
      rlsEnabled: true,
      rlsForced: false,
      securityInvoker: null,
      securityDefiner: null,
      enumValues: null,
      marker: markerSecret
    }
    try {
      await inspect(transport({ result: readResult({ objects: [object] }) }))
      throw new Error('Expected managed marker rejection')
    } catch (error) {
      expect(diagnosticCode(error)).toBe('supabase-pg-catalog-managed-marker-invalid')
      expect(error instanceof Error ? error.message : String(error)).not.toContain(SECRET)
      expect(JSON.stringify((error as SupabasePgCatalogInspectionError).diagnostics)).not.toContain(
        SECRET
      )
    }
  })

  test('binds address-validated managed markers into the current DataModelIR', async () => {
    const table = {
      classOid: '1259',
      objectOid: '16384',
      subId: 0,
      schemaOid: '2200',
      schemaName: 'public',
      kind: 'table',
      objectName: 'notes',
      rlsEnabled: true,
      rlsForced: true,
      securityInvoker: null,
      securityDefiner: null,
      enumValues: null,
      marker: formatSupabaseManagedMarker('entity', 'notes')
    }
    const column = {
      classOid: '1259',
      objectOid: '16384',
      subId: 1,
      schemaOid: '2200',
      schemaName: 'public',
      tableName: 'notes',
      columnName: 'id',
      typeOid: '2950',
      typeSchema: 'pg_catalog',
      typeName: 'uuid',
      typeKind: 'b',
      nullable: false,
      defaultExpression: null,
      identityKind: '',
      generatedKind: '',
      columnPrivilegesPresent: false,
      marker: formatSupabaseManagedMarker('field', 'id')
    }
    const constraint = {
      classOid: '2606',
      objectOid: '17000',
      subId: 0,
      schemaOid: '2200',
      schemaName: 'public',
      tableOid: '16384',
      tableName: 'notes',
      constraintName: 'openpencil_pk_notes',
      constraintType: 'p',
      fields: ['id'],
      targetTableOid: null,
      targetTableName: null,
      targetFields: [],
      onDeleteCode: ' ',
      definition: 'PRIMARY KEY (id)',
      marker: formatSupabaseManagedMarker('primary-key', 'notes')
    }
    const snapshot = await inspect(
      transport({
        result: readResult({ objects: [table], columns: [column], constraints: [constraint] })
      })
    )

    expect(snapshot.currentModel).toEqual({
      version: 1,
      entities: [
        {
          id: 'notes',
          name: 'notes',
          management: 'managed',
          fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
          primaryKey: { fields: ['id'] }
        }
      ],
      enums: [],
      relations: []
    })
    expect(snapshot.objects[0]).toMatchObject({
      kind: 'table',
      management: 'managed',
      openPencilId: 'notes'
    })
  })

  test('rejects column ACLs and enum types outside the inspected public enum OID', async () => {
    const table = {
      classOid: '1259',
      objectOid: '16384',
      subId: 0,
      schemaOid: '2200',
      schemaName: 'public',
      kind: 'table',
      objectName: 'notes',
      rlsEnabled: true,
      rlsForced: true,
      securityInvoker: null,
      securityDefiner: null,
      enumValues: null,
      marker: formatSupabaseManagedMarker('entity', 'notes')
    }
    const column = {
      classOid: '1259',
      objectOid: '16384',
      subId: 1,
      schemaOid: '2200',
      schemaName: 'public',
      tableName: 'notes',
      columnName: 'status',
      typeOid: '50000',
      typeSchema: 'public',
      typeName: 'note_status',
      typeKind: 'e',
      nullable: true,
      defaultExpression: null,
      identityKind: '',
      generatedKind: '',
      columnPrivilegesPresent: false,
      marker: formatSupabaseManagedMarker('field', 'status')
    }
    const dataEnum = {
      classOid: '1247',
      objectOid: '50000',
      subId: 0,
      schemaOid: '2200',
      schemaName: 'public',
      kind: 'enum',
      objectName: 'note_status',
      rlsEnabled: null,
      rlsForced: null,
      securityInvoker: null,
      securityDefiner: null,
      enumValues: ['draft'],
      marker: formatSupabaseManagedMarker('enum', 'note-status')
    }

    await expectDiagnostic(
      inspect(
        transport({
          result: readResult({
            objects: [table, dataEnum],
            columns: [{ ...column, columnPrivilegesPresent: true }]
          })
        })
      ),
      'supabase-pg-catalog-column-privileges-unsupported'
    )
    await expectDiagnostic(
      inspect(
        transport({
          result: readResult({
            objects: [table, dataEnum],
            columns: [{ ...column, typeOid: '60000', typeSchema: 'shadow' }]
          })
        })
      ),
      'supabase-pg-catalog-address-mismatch'
    )
  })

  test('rejects relation column ACL evidence and malformed provenance before snapshot authorization', async () => {
    await expectDiagnostic(
      inspect(
        transport({
          result: readResult({
            provenance: [{ ...provenanceRow(), columnPrivilegesPresent: true }]
          })
        })
      ),
      'supabase-pg-catalog-column-privileges-unsupported'
    )
    await expectDiagnostic(
      inspect(
        transport({
          result: readResult({
            provenance: [{ ...provenanceRow(), columnPrivilegesPresent: 'false' }]
          })
        })
      ),
      'supabase-pg-catalog-row-invalid'
    )
  })

  test('sanitizes transport failures without exposing credential material', async () => {
    const authorityFailure: SupabasePgCatalogHostTransport = {
      async getProjectAuthority() {
        throw new Error(`authorization failed for ${SECRET}`)
      },
      async runReadOnlyCatalogQueries() {
        throw new Error(`query failed for ${SECRET}`)
      }
    }
    const queryFailure: SupabasePgCatalogHostTransport = {
      async getProjectAuthority() {
        return projectAuthority()
      },
      async runReadOnlyCatalogQueries() {
        throw new Error(`query failed for ${SECRET}`)
      }
    }

    for (const failing of [authorityFailure, queryFailure]) {
      try {
        await inspect(failing)
        throw new Error('Expected transport failure')
      } catch (error) {
        expect(diagnosticCode(error)).toBe('supabase-pg-catalog-transport-failed')
        expect(error instanceof Error ? error.message : String(error)).not.toContain(SECRET)
        expect(
          JSON.stringify((error as SupabasePgCatalogInspectionError).diagnostics)
        ).not.toContain(SECRET)
      }
    }
  })
})
