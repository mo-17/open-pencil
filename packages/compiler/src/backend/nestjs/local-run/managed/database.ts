import { MANAGED_CATALOG_SOURCE } from './catalog'

/** Shared managed-preview bookkeeping; all database connections and container checks reuse local-run. */
export const MANAGED_DATABASE_SOURCE = String.raw`import { createHash } from 'node:crypto'
import { databaseClient, migration } from '../local-database.mjs'
import { fail } from '../local-config.mjs'

const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('base64url')
const digest = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value)
const quote = (name) => '"' + name.replaceAll('"', '""') + '"'
function schemaTables(schema) {
  if (!Array.isArray(schema) || !schema.length || schema.some((table) => !/^[a-z][a-z0-9_]{0,47}$/.test(table.name) || !Array.isArray(table.columns) || !Array.isArray(table.indexes) || !Array.isArray(table.constraints))) fail('Managed preview expected schema is invalid.')
  return schema
}
export async function grantManagedTables(client, schema) {
  for (const table of schemaTables(schema)) await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.' + quote(table.name) + ' TO openpencil_runtime')
}
function exact(actual, expected) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) fail('Managed preview live schema differs from the exact generated model. Existing data was preserved.')
}
${MANAGED_CATALOG_SOURCE}
function validateCatalog(values, schema) {
  const expected = schemaTables(schema)
  const [relations, columns, constraints, indexes, policies, triggers] = values
  exact(relations.map((row) => row.name + ':' + row.kind), expected.flatMap((table) => [table.name + ':r', ...table.indexes.map((name) => name + ':i')]))
  if (relations.some((row) => row.owner !== 'openpencil_admin' || row.rls || row.force_rls) || policies.length || triggers.length) fail('Managed preview live schema ownership or executable policy differs.')
  exact(columns.map((row) => row.table_name + ':' + row.column_name + ':' + row.udt_name + ':' + row.is_nullable), expected.flatMap((table) => table.columns.map((column) => table.name + ':' + column.name + ':' + column.type + ':' + (column.nullable ? 'YES' : 'NO'))))
  exact(constraints.map((row) => row.table_name + ':' + row.conname + ':' + row.contype), expected.flatMap((table) => table.constraints.map((name) => table.name + ':' + name + ':' + (table.catalog?.constraints.find((entry) => entry.name===name)?.kind ?? 'p'))))
  exact(indexes.map((row) => row.tablename + ':' + row.indexname), expected.flatMap((table) => table.indexes.map((name) => table.name + ':' + name)))
}
async function snapshot(client, schema, lock = false) {
  const tables = await client.query("SELECT c.relname AS name, c.relkind AS kind, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls, pg_get_userbyid(c.relowner) AS owner, c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,c.relkind")
  if (lock) for (const table of tables.rows.filter((row) => ['r','p'].includes(row.kind))) {
    await client.query('LOCK TABLE public."' + table.name.replaceAll('"', '""') + '" IN ACCESS EXCLUSIVE MODE')
  }
  const queries = [
    "SELECT table_name,column_name,ordinal_position,udt_name,is_nullable,column_default,is_identity,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    "SELECT c.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname",
    "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
    "SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
    "SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname"
  ]
  const values = [tables.rows]
  for (const sql of queries) values.push((await client.query(sql)).rows)
  validateCatalog(values, schema)
  values.push(...await extendedCatalog(client, schema))
  const role = (await client.query("SELECT rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='openpencil_runtime'")).rows
  if (role.length !== 1 || role[0].rolsuper || role[0].rolinherit || role[0].rolcreaterole || role[0].rolcreatedb || !role[0].rolcanlogin || role[0].rolreplication || role[0].rolbypassrls) fail('Managed preview runtime role privileges changed.')
  const memberships = (await client.query("SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='openpencil_runtime' ORDER BY r.rolname")).rows
  if (memberships.length) fail('Managed preview runtime role membership changed.')
  const grants = (await client.query("SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema='public' ORDER BY table_name,grantee,privilege_type,is_grantable")).rows
  exact(grants.filter((row) => row.grantee === 'openpencil_runtime').map((row) => row.table_name + ':' + row.privilege_type + ':' + row.is_grantable), schema.flatMap((table) => ['DELETE','INSERT','SELECT','UPDATE'].map((privilege) => table.name + ':' + privilege + ':NO')))
  if (grants.some((row) => !['openpencil_admin','openpencil_runtime'].includes(row.grantee))) fail('Managed preview unexpected public schema grants changed.')
  const namespaces = (await client.query("SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname IN ('public','openpencil_local') ORDER BY nspname")).rows
  const database = (await client.query("SELECT datname,pg_get_userbyid(datdba) AS owner,datacl::text AS acl FROM pg_database WHERE datname=current_database()")).rows
  const defaults = (await client.query("SELECT pg_get_userbyid(defaclrole) AS role,defaclnamespace::regnamespace::text AS namespace,defaclobjtype,defaclacl::text AS acl FROM pg_default_acl ORDER BY defaclrole,defaclnamespace,defaclobjtype")).rows
  const permissions = (await client.query("SELECT has_database_privilege('openpencil_runtime',current_database(),'CONNECT') AS connect,has_database_privilege('openpencil_runtime',current_database(),'CREATE') AS database_create,has_schema_privilege('openpencil_runtime','public','USAGE') AS public_usage,has_schema_privilege('openpencil_runtime','public','CREATE') AS public_create,has_schema_privilege('openpencil_runtime','openpencil_local','USAGE') AS receipt_usage,has_schema_privilege('openpencil_runtime','openpencil_local','CREATE') AS receipt_create")).rows[0]
  if (!permissions?.connect || permissions.database_create || !permissions.public_usage || permissions.public_create || permissions.receipt_usage || permissions.receipt_create || defaults.length) fail('Managed preview runtime schema or database privileges changed.')
  return { schemaDigest: hash([...values, role, memberships, grants, namespaces, database, defaults]), authorityDigest: hash([role, memberships, namespaces, database, defaults]) }
}
export async function initializeManagedReceipt(client, applicationDigest, fresh, planId, schema) {
  if (!digest(applicationDigest) || !digest(planId)) fail('Invalid managed preview identity.')
  const existing = await client.query("SELECT to_regclass('openpencil_local.managed_state') AS name")
  if (existing.rows[0].name) {
    const receipt = (await client.query('SELECT application_digest,schema_digest FROM openpencil_local.managed_state WHERE id=1')).rows[0]
    if (receipt?.application_digest !== applicationDigest || receipt.schema_digest !== (await snapshot(client, schema, true)).schemaDigest) fail('Managed preview receipt or live schema differs; setup never adopts existing data.')
    return
  }
  if (!fresh) fail('Existing database has no managed preview receipt; it cannot be adopted.')
  await client.query('CREATE TABLE openpencil_local.managed_state (id integer PRIMARY KEY CHECK(id=1), application_digest text NOT NULL, schema_digest text NOT NULL, plan_digest text NOT NULL)')
  await client.query('INSERT INTO openpencil_local.managed_state(id,application_digest,schema_digest,plan_digest) VALUES(1,$1,$2,$3)', [applicationDigest, (await snapshot(client, schema, true)).schemaDigest, planId])
}
export async function inspectManagedDatabase(config, secrets, schema) {
  const client = await databaseClient(config, secrets, true)
  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(1869636974, 1)')
    const receipt = (await client.query('SELECT application_digest,schema_digest,plan_digest FROM openpencil_local.managed_state WHERE id=1 FOR UPDATE')).rows[0]
    if (!receipt || receipt.schema_digest !== (await snapshot(client, schema, true)).schemaDigest) fail('Managed preview live schema drifted from its receipt. No migration was applied.')
    await client.query('COMMIT')
    return receipt
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof Error && error.message.startsWith('Managed preview live')) throw error
    fail('Managed preview receipt could not be verified. Existing data was preserved.')
  } finally { await client.end().catch(() => undefined) }
}
export async function applyManagedMigration(config, secrets, plan) {
  if (!digest(plan.planId) || !digest(plan.fromApplicationDigest) || !digest(plan.toApplicationDigest) ||
      typeof plan.sql !== 'string' || plan.sql.length > 1048576 || hash(plan.sql) !== plan.sqlDigest || migration().digest !== plan.initialDigest) fail('Managed migration plan is invalid or stale.')
  const client = await databaseClient(config, secrets, true)
  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout='3s'")
    await client.query('SELECT pg_advisory_xact_lock(1869636974, 1)')
    const receipt = (await client.query('SELECT application_digest,schema_digest,plan_digest FROM openpencil_local.managed_state WHERE id=1 FOR UPDATE')).rows[0]
    const recovered = receipt?.application_digest === plan.toApplicationDigest && receipt.plan_digest === plan.planId
    const before = await snapshot(client, recovered ? plan.toSchema : plan.fromSchema, true)
    if (!receipt || receipt.schema_digest !== before.schemaDigest) fail('Managed preview live schema drifted from its receipt. No migration was applied.')
    // Recovery after COMMIT but before the companion commits its filesystem pointer.
    if (receipt.application_digest === plan.toApplicationDigest && receipt.plan_digest === plan.planId) { await client.query('COMMIT'); return receipt }
    if (receipt.application_digest !== plan.fromApplicationDigest) fail('Managed preview migration source receipt changed. Review a fresh plan.')
    if (plan.sql) await client.query(plan.sql)
    await grantManagedTables(client, plan.toSchema)
    const after = await snapshot(client, plan.toSchema, true)
    if (after.authorityDigest !== before.authorityDigest) fail('Managed preview database authority changed during migration. Existing data was preserved.')
    const schemaDigest = after.schemaDigest
    await client.query('UPDATE openpencil_local.managed_state SET application_digest=$1,schema_digest=$2,plan_digest=$3 WHERE id=1', [plan.toApplicationDigest, schemaDigest, plan.planId])
    await client.query('COMMIT')
    return { application_digest: plan.toApplicationDigest, schema_digest: schemaDigest, plan_digest: plan.planId }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof Error && error.message.startsWith('Managed preview')) throw error
    fail('Managed preview migration failed and rolled back. Existing data was preserved.')
  } finally { await client.end().catch(() => undefined) }
}
`
