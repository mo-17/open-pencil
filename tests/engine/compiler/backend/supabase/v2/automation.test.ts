/* eslint-disable max-lines -- Queue, Cron, idempotency, and outbox artifacts share one review-authority boundary. */
import { describe, expect, test } from 'bun:test'

import {
  backendProviderPlanDigestV2,
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  emitBackendProviderPlanV2,
  SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2,
  SUPABASE_AUTOMATION_PROVIDER_ADAPTER_VERSION_V2,
  SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2
} from '@open-pencil/compiler'

import { supabaseAutomationApplicationV2, supabasePrivateRealtimeSelectionV2 } from './helpers'

const DIRECT_API_ROLE_REVOKE = 'FROM PUBLIC, "anon", "authenticated", "authenticator";'
const EFFECTIVE_API_ROLE_VALUES = `(VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role'))`

function createPlan(
  application = supabaseAutomationApplicationV2(),
  mode: 'preview' | 'source-only-prototype' | 'production' = 'production'
) {
  const registry = createBackendProviderRegistryV2([SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2])
  const selection = supabasePrivateRealtimeSelectionV2(SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2)
  const result = createBackendProviderPlanV2(registry, {
    selection,
    application,
    target: 'react',
    mode
  })
  return { registry, selection, result }
}

function emittedArtifacts(application = supabaseAutomationApplicationV2()) {
  const planned = createPlan(application)
  expect(planned.result.ok).toBe(true)
  if (!planned.result.ok) throw new Error(JSON.stringify(planned.result.diagnostics))
  const emitted = emitBackendProviderPlanV2(planned.registry, {
    plan: planned.result.plan,
    selection: planned.selection
  })
  if (!emitted.ok) throw new Error(JSON.stringify(emitted.diagnostics))
  expect(emitted.ok).toBe(true)
  const artifact = (path: string): string => {
    const content = emitted.emission.files.get(path)
    if (typeof content !== 'string') throw new Error(`Missing text artifact: ${path}`)
    return content
  }
  return { ...planned, plan: planned.result.plan, emission: emitted.emission, artifact }
}

function queueOnlyApplication() {
  const application = supabaseAutomationApplicationV2()
  return {
    ...application,
    automations: {
      ...application.automations,
      webhookDestinations: [],
      automations: []
    },
    capabilities: application.capabilities.filter(({ capability }) =>
      ['migrations.schema', 'queues.consume', 'queues.publish'].includes(capability)
    ),
    secrets: []
  }
}

describe('Supabase Backend Provider V2 automation review artifacts', () => {
  test('routes the bounded server-owned slice through a deterministic candidate adapter', () => {
    expect(SUPABASE_AUTOMATION_PROVIDER_ADAPTER_VERSION_V2).toBe('2.4.0')
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.descriptor.adapterVersion).toBe('2.3.0')
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.descriptor.adapterId).not.toBe(
      SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2.descriptor.adapterId
    )
    expect(SUPABASE_BACKEND_PROVIDER_BUNDLE_V2.descriptor.capabilities).not.toContain(
      'jobs.schedule'
    )
    expect(SUPABASE_AUTOMATION_PROVIDER_BUNDLE_V2.automations).toMatchObject({
      capabilities: [
        'jobs.schedule',
        'queues.consume',
        'queues.publish',
        'webhooks.deliver',
        'webhooks.receive',
        'workflows.durable-execution',
        'workflows.idempotency',
        'workflows.retry'
      ],
      outputs: ['deployment-manifest', 'migration-plan', 'server-runtime']
    })
    const first = emittedArtifacts()
    const second = emittedArtifacts()

    expect(first.plan.planDigest).toBe(second.plan.planDigest)
    expect(first.emission.manifestDigest).toBe(second.emission.manifestDigest)
    expect([...first.emission.files]).toEqual([...second.emission.files])
    expect(first.plan.actualCapabilities).toEqual([
      'jobs.schedule',
      'migrations.schema',
      'queues.consume',
      'queues.publish',
      'server.functions',
      'webhooks.deliver',
      'webhooks.receive',
      'workflows.durable-execution',
      'workflows.idempotency',
      'workflows.retry'
    ])
    expect(Object.keys(first.plan.adapterPlans)).toEqual(['server', 'migrations', 'automations'])
    expect(first.plan.capabilities.every((entry) => entry.included)).toBe(true)

    const plan = first.plan.adapterPlans.automations as {
      reviewOnly: boolean
      applyAllowed: boolean
      deployAllowed: boolean
      runtimeAuthorityCreated: boolean
      credentialAuthorityCreated: boolean
      networkAuthorityCreated: boolean
      queues: readonly { physicalName: string }[]
      dispatchQueueName: string
    }
    expect(plan).toMatchObject({
      reviewOnly: true,
      applyAllowed: false,
      deployAllowed: false,
      runtimeAuthorityCreated: false,
      credentialAuthorityCreated: false,
      networkAuthorityCreated: false,
      requiredExtensions: ['pg_cron', 'pgmq'],
      extensionBootstrapAllowed: false,
      extensionInventoryVerification: 'trusted-post-apply-receipt-required',
      expectedPostApplyState: {
        evidenceStatus: 'unverified-until-trusted-post-apply-receipt',
        acceptedReceipt: false,
        queues: {
          existingGeneratedQueuePolicy: 'reject',
          exposure: 'postgres-server-only',
          durability: 'logged',
          partitioning: 'none',
          declaredRuntimeConfiguration: 'marker-only-not-database-enforced',
          completeAclInventory: 'unverified',
          publicAnonAuthenticatedServiceRoleTableAccess: 'none'
        },
        cron: {
          existingSameNameJobPolicy: 'reject',
          timezone: 'effective-zero-offset-UTC',
          username: 'current-user',
          database: 'current-database',
          connectionTarget: 'local-current-database-server'
        }
      },
      retirement: {
        automatic: false,
        explicitApprovalRequired: true,
        inspectedInventoryVerified: false
      }
    })
    expect(plan.dispatchQueueName).toMatch(/^op_dispatch_[a-z0-9_-]{20}$/u)
    expect(plan.queues.every((queue) => /^op_[a-z0-9_-]{20}$/u.test(queue.physicalName))).toBe(true)
  })

  test('emits fail-closed logged Queue and zero-offset UTC Cron review SQL', () => {
    const result = emittedArtifacts()
    const sql = result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)
    const plan = result.plan.adapterPlans.automations as {
      dispatchQueueName: string
      queues: readonly { physicalName: string }[]
    }
    const queueStart = sql.indexOf('DO $openpencil_queue_inventory$')
    const queueSql = sql.slice(queueStart)
    const queueTableRevokeCount =
      queueSql.split('\nREVOKE ALL PRIVILEGES ON TABLE "pgmq".').length - 1
    const queueEffectivePrivilegeCheckCount =
      queueSql.split('"pg_catalog"."has_table_privilege"(').length - 1

    expect(sql).toStartWith('-- OpenPencil Supabase automation migration review v1.\n')
    expect(sql).toContain(
      'BEGIN;\nSET LOCAL search_path = pg_catalog;\nSELECT "pg_catalog"."pg_advisory_xact_lock"('
    )
    expect(sql).toContain('"pg_catalog"."hashtextextended"(')
    expect(sql).toContain('SET LOCAL search_path = pg_catalog;')
    expect(sql).not.toContain('CREATE EXTENSION')
    expect(sql).toContain('"extname" = \'pgmq\'')
    expect(sql).toContain('"extname" = \'pg_cron\'')
    expect(sql).toContain('"to_regprocedure"(\'pgmq.create(text)\')')
    expect(sql).toContain('"to_regprocedure"(\'cron.schedule(text,text,text)\')')
    expect(sql).toContain('requires a dedicated non-API role without superuser or BYPASSRLS')
    expect(sql).toContain(
      "IF CURRENT_USER IN ('anon', 'authenticated', 'authenticator', 'postgres')"
    )
    expect(sql).toContain('LOCK TABLE "cron"."job" IN SHARE ROW EXCLUSIVE MODE;')
    expect(sql).toContain('"current_setting"(\'cron.timezone\', TRUE)')
    expect(sql).toContain('requires pg_cron to use an effective zero-offset UTC timezone')
    expect(sql).toContain('FROM "pgmq"."list_queues"()')
    expect(sql).toContain('PERFORM "pgmq"."create"(')
    expect(sql).toContain('"relkind" = \'r\'')
    expect(sql).toContain('"relpersistence" = \'p\'')
    expect(sql).toContain('COMMENT ON TABLE "pgmq"."q_')
    expect(sql).toContain('openpencil.supabase-automation-queue.v1;application=')
    expect(sql).toContain(';configuration-digest:')
    expect(queueStart).toBeGreaterThan(-1)
    expect(queueSql.split(DIRECT_API_ROLE_REVOKE).length - 1).toBe(queueTableRevokeCount)
    expect(queueSql.split(EFFECTIVE_API_ROLE_VALUES).length - 1).toBe(
      queueEffectivePrivilegeCheckCount
    )
    expect(queueSql).not.toContain('FROM PUBLIC, "anon", "authenticated";')
    expect(queueSql).not.toContain(`(VALUES ('anon'), ('authenticated'), ('service' || '_role'))`)
    expect(sql).toContain("'service' || '_role'")
    expect(sql).not.toContain('service_role')
    expect(sql).toContain('"pg_catalog"."aclexplode"(')
    expect(sql).toContain('"pg_catalog"."has_table_privilege"(')
    expect(sql).toContain('scheduled_job_id := "cron"."schedule"(')
    expect(sql).toContain(`'${plan.dispatchQueueName}'`)
    expect(sql).toContain('openpencil.supabase-automation-cron-command.v1;application=')
    expect(sql).toContain("'format', 'openpencil.supabase-schedule-event.v1'")
    expect(sql).toContain("'automationId', 'scheduled-publish'")
    expect(sql).toContain('"pg_catalog"."gen_random_uuid"()')
    expect(sql).toContain('AND "username" = CURRENT_USER')
    expect(sql).toContain('AND "database" = CURRENT_DATABASE()')
    expect(sql).toContain('AND "command" = expected_command')
    expect(sql).toContain('AND "active" IS TRUE')
    expect(sql).toContain('"nspname" = \'pgmq_public\'')
    expect(sql).toContain(
      'refuses queue creation while the generic pgmq Data API wrapper schema exists'
    )
    expect(sql).not.toContain('CREATE SCHEMA "pgmq_public"')
    expect(sql).not.toContain('GRANT USAGE ON SCHEMA "pgmq_public"')
    expect(sql).toContain("AND \"nodename\" IN ('localhost', '127.0.0.1')")
    expect(sql).toContain('AND "nodeport" = "pg_catalog"."current_setting"(\'port\')::integer')
    expect(sql).not.toContain('https://')
    expect(sql).toEndWith('COMMIT;\n')
    for (const queue of plan.queues) {
      expect(sql).toContain(`"pgmq"."q_${queue.physicalName}"`)
      expect(sql).toContain(`"pgmq"."a_${queue.physicalName}"`)
      expect(queueSql).toContain(
        `REVOKE ALL PRIVILEGES ON TABLE "pgmq"."q_${queue.physicalName}" ${DIRECT_API_ROLE_REVOKE}`
      )
      expect(queueSql).toContain(
        `REVOKE ALL PRIVILEGES ON TABLE "pgmq"."a_${queue.physicalName}" ${DIRECT_API_ROLE_REVOKE}`
      )
    }
  })

  test('emits a one-shot schema-only idempotency CAS ledger without writer authority', () => {
    const result = emittedArtifacts()
    const sql = result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)
    const review = JSON.parse(result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.reviewManifest))
    const ledger = review.expectedPostApplyState.idempotencyLedger as {
      schemaName: string
    }
    const outboxStart = sql.indexOf('DO $openpencil_transactional_outbox_inventory$')
    const ledgerSql = sql.slice(0, outboxStart)
    const chainStart = ledgerSql.indexOf('CONSTRAINT "idempotency_revisions_chain_check" CHECK (')
    const transitionStart = ledgerSql.indexOf(
      'CONSTRAINT "idempotency_revisions_transition_check" CHECK ('
    )
    const chainSql = ledgerSql.slice(chainStart, transitionStart)
    const schema = `"${ledger.schemaName}"`
    const revisions = `${schema}."idempotency_revisions"`
    const heads = `${schema}."idempotency_heads"`
    const refusal = sql.indexOf(
      'OpenPencil refuses to adopt or replace a pre-existing idempotency ledger schema.'
    )
    const createSchema = sql.indexOf(`CREATE SCHEMA ${schema} AUTHORIZATION CURRENT_USER;`)
    const rolePreflight = sql.indexOf('OpenPencil Automation SQL requires a dedicated non-API role')

    expect(ledger.schemaName).toMatch(/^op_automation_[a-z0-9_-]{20}$/u)
    expect(refusal).toBeGreaterThan(-1)
    expect(rolePreflight).toBeGreaterThan(-1)
    expect(refusal).toBeGreaterThan(rolePreflight)
    expect(createSchema).toBeGreaterThan(refusal)
    expect(sql).toContain(
      'found a previously generated idempotency ledger; retirement or replacement requires explicit approval'
    )
    expect(sql).toContain(`CREATE TABLE ${revisions} (`)
    expect(sql).toContain(`CREATE TABLE ${heads} (`)
    expect(sql).toContain('FROM "pg_catalog"."pg_description" AS "prior_ledger_marker"')
    expect(sql).toContain('LEFT("prior_ledger_marker"."description"')
    expect(sql).not.toContain('"prior_ledger_marker"."description" LIKE')
    expect(sql).toContain('PRIMARY KEY ("automation_id", "idempotency_key_digest", "revision")')
    expect(sql).toContain('PRIMARY KEY ("automation_id", "idempotency_key_digest")')
    expect(sql).toContain('"expected_revision" = "revision" - 1')
    expect(chainStart).toBeGreaterThan(-1)
    expect(transitionStart).toBeGreaterThan(chainStart)
    for (const expectedColumn of [
      'expected_revision',
      'expected_head_digest',
      'expected_event_id',
      'expected_operation_id',
      'expected_causation_id',
      'expected_causation_hop',
      'expected_attempt_id',
      'expected_attempt_ordinal',
      'expected_state',
      'expected_recorded_at',
      'expected_retention_expires_at'
    ]) {
      expect(chainSql).toContain(`"${expectedColumn}" IS NOT NULL`)
    }
    expect(sql).toContain('"expected_head_digest" IS NOT NULL')
    expect(sql).toContain('"event_id" = "expected_event_id"')
    expect(sql).toContain('"operation_id" = "expected_operation_id"')
    expect(sql).toContain('"causation_id" = "expected_causation_id"')
    expect(sql).toContain('"causation_hop" = "expected_causation_hop"')
    expect(sql).toContain('"recorded_at" >= "expected_recorded_at"')
    expect(ledgerSql.split('"revision" BETWEEN 1 AND 1024').length - 1).toBe(5)
    expect(sql).toContain(
      '"revision" BETWEEN 1 AND 1024\n      AND "expected_state" = \'reserved\''
    )
    expect(sql).toContain(
      '"revision" BETWEEN 1 AND 1024\n      AND "expected_state" = \'dispatch-started\''
    )
    expect(sql).toContain(
      '"revision" BETWEEN 1 AND 1024\n      AND "expected_state" = \'outcome-unknown\''
    )
    expect(sql).toContain(
      '"revision" BETWEEN 1 AND 1024\n      AND "expected_state" = \'known-not-dispatched\''
    )
    expect(ledgerSql.split('^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$').length - 1).toBe(16)
    expect(sql).not.toContain('^[A-Za-z0-9_-]{43}$')
    expect(sql).toContain('MATCH SIMPLE DEFERRABLE INITIALLY DEFERRED')
    expect(sql).toContain('MATCH FULL DEFERRABLE INITIALLY DEFERRED')
    expect(sql).toContain(
      "\"expected_state\" = 'outcome-unknown'\n      AND \"state\" IN ('succeeded', 'known-not-dispatched')"
    )
    expect(sql).toContain(
      '"state" = \'outcome-unknown\' AND "retry_fence" = \'reconciliation-required\''
    )
    expect(sql).toContain('"retention_expires_at" timestamp with time zone NOT NULL')
    expect(sql).toContain('CREATE UNIQUE INDEX "idempotency_revisions_attempt_reservation_uidx"')
    expect(sql).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE ON')
    expect(sql).toContain('idempotency revisions are append-only')
    expect(sql).toContain('COMMENT ON CONSTRAINT "idempotency_revisions_previous_fkey"')
    expect(sql).toContain('COMMENT ON INDEX')
    expect(ledgerSql).toContain(
      `REVOKE ALL PRIVILEGES ON SCHEMA ${schema} ${DIRECT_API_ROLE_REVOKE}`
    )
    expect(ledgerSql).toContain(
      `REVOKE ALL PRIVILEGES ON TABLE ${revisions}, ${heads} ${DIRECT_API_ROLE_REVOKE}`
    )
    expect(ledgerSql).toContain(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${schema}."reject_idempotency_revision_mutation"() ${DIRECT_API_ROLE_REVOKE}`
    )
    expect(ledgerSql.split(EFFECTIVE_API_ROLE_VALUES).length - 1).toBe(5)
    expect(sql).toContain("('service' || '_role')")
    expect(sql).not.toContain('service_role')
    expect(sql).toContain('FROM "pg_catalog"."pg_attribute" AS "table_column"')
    expect(ledgerSql).toContain('"table_column"."attcollation" AS "collation_oid"')
    expect(ledgerSql).toContain('"table_column"."attacl" AS "column_acl"')
    expect(ledgerSql).toContain(
      '"actual_column"."collation_oid" IS DISTINCT FROM "expected_column"."collation_oid"'
    )
    expect(ledgerSql).toContain('"actual_column"."column_acl" IS NOT NULL')
    expect(sql).toContain('FROM "pg_catalog"."pg_constraint" AS "table_constraint"')
    expect(ledgerSql).toContain(
      "('idempotency_revisions', 'idempotency_revisions_pkey', 'p', TRUE,"
    )
    expect(ledgerSql).toContain(
      "('idempotency_revisions', 'idempotency_revisions_identifiers_check', 'c', FALSE,"
    )
    expect(ledgerSql).toContain(
      '"actual_constraint"."no_inherit" IS DISTINCT FROM "expected_constraint"."no_inherit"'
    )
    expect(ledgerSql).toContain(
      '"pg_catalog"."pg_get_constraintdef"("table_constraint"."oid", FALSE)'
    )
    expect(ledgerSql).toContain(
      '"actual_constraint"."definition" IS DISTINCT FROM "expected_constraint"."definition"'
    )
    expect(ledgerSql).toContain('CHECK (((current_revision >= 0) AND (current_revision <= 1024)))')
    expect(sql).toContain('FROM "pg_catalog"."pg_index" AS "table_index"')
    expect(ledgerSql).toContain('"pg_catalog"."pg_get_indexdef"("index_relation"."oid")')
    expect(ledgerSql).toContain(
      '"actual_index"."definition" IS DISTINCT FROM "expected_index"."definition"'
    )
    expect(ledgerSql).toContain(
      'ARRAY(SELECT "pg_catalog"."unnest"("table_index"."indkey"))::smallint[]'
    )
    expect(ledgerSql).toContain(
      'ARRAY(SELECT "pg_catalog"."unnest"("attempt_index"."indkey"))::smallint[]'
    )
    expect(ledgerSql).not.toContain('"table_index"."indkey"::smallint[]')
    expect(sql).toContain(
      '"chain_constraint"."conkey" = ARRAY[1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]'
    )
    expect(sql).toContain('"head_constraint"."conkey" = ARRAY[1, 2]::smallint[]')
    expect(ledgerSql).toContain('"guard_proc"."prosrc" =')
    expect(ledgerSql).toContain('"guard_proc"."probin" IS NULL')
    expect(ledgerSql).toContain('"guard_proc"."prosqlbody" IS NULL')
    expect(ledgerSql).toContain(
      "('idempotency_heads_revision_fkey', 'idempotency_heads', 'RI_FKey_check_ins', 5, 'idempotency_revisions')"
    )
    expect(ledgerSql).toContain(
      "('idempotency_heads_revision_fkey', 'idempotency_revisions', 'RI_FKey_noaction_upd', 17, 'idempotency_heads')"
    )
    expect(ledgerSql).toContain('"internal_trigger"."tgparentid" AS "parent_oid"')
    expect(ledgerSql).toContain('"actual_internal_trigger"."argument_bytes" <> 0')
    expect(ledgerSql).toContain('FROM "pg_catalog"."pg_rewrite" AS "ledger_rule"')
    expect(ledgerSql).toContain('FROM "pg_catalog"."pg_policy" AS "ledger_policy"')
    expect(ledgerSql).toContain('"ledger_publication"."puballtables"')
    expect(ledgerSql).toContain('FROM "pg_catalog"."pg_publication_rel" AS "published_relation"')
    expect(ledgerSql).toContain(
      'FROM "pg_catalog"."pg_publication_namespace" AS "published_schema"'
    )
    expect(ledgerSql).toContain('"database_role"."oid", expected_owner, \'MEMBER\'')
    expect(ledgerSql).toContain('"pg_catalog"."has_column_privilege"(')
    expect(sql).toContain('A non-owner retains a direct privilege')
    expect(sql).toContain('A known Supabase API role retains effective access')
    expect(sql).not.toContain(`INSERT INTO ${revisions}`)
    expect(sql).not.toContain(`UPDATE ${heads}`)
    expect(sql).not.toContain(`DELETE FROM ${revisions}`)
    expect(sql).not.toContain('CREATE POLICY')
    expect(sql).not.toContain('GRANT ')

    const applicationWithHyphenatedKey = {
      ...supabaseAutomationApplicationV2(),
      applicationId: 'test.supabase-automations-1'
    }
    const hyphenated = emittedArtifacts(applicationWithHyphenatedKey)
    const hyphenatedReview = JSON.parse(
      hyphenated.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.reviewManifest)
    )
    const hyphenatedSchema = hyphenatedReview.expectedPostApplyState.idempotencyLedger
      .schemaName as string
    expect(hyphenatedSchema).toContain('-')
    expect(hyphenated.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)).toContain(
      `CREATE SCHEMA "${hyphenatedSchema}" AUTHORIZATION CURRENT_USER;`
    )
    expect(hyphenated.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)).toContain(
      `REFERENCES "${hyphenatedSchema}".idempotency_revisions`
    )
  })

  test('emits an application-scoped one-shot transactional outbox without DML authority', () => {
    const result = emittedArtifacts()
    const sql = result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)
    const review = JSON.parse(result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.reviewManifest))
    const outbox = review.expectedPostApplyState.transactionalOutbox as {
      schemaName: string
    }
    const ledgerSchema = review.expectedPostApplyState.idempotencyLedger.schemaName as string
    const schema = `"${outbox.schemaName}"`
    const bindings = `${schema}."outbox_bindings"`
    const revisions = `${schema}."outbox_revisions"`
    const heads = `${schema}."outbox_heads"`
    const outboxStart = sql.indexOf('DO $openpencil_transactional_outbox_inventory$')
    const outboxEnd = sql.indexOf('DO $openpencil_cron_preflight$', outboxStart)
    const outboxSql = sql.slice(outboxStart, outboxEnd)
    const chainStart = outboxSql.indexOf('CONSTRAINT "outbox_revisions_chain_check" CHECK (')
    const transitionStart = outboxSql.indexOf(
      'CONSTRAINT "outbox_revisions_transition_check" CHECK ('
    )
    const chainSql = outboxSql.slice(chainStart, transitionStart)
    const refusal = sql.indexOf(
      'OpenPencil refuses to adopt or replace a pre-existing transactional outbox schema.'
    )
    const createSchema = sql.indexOf(`CREATE SCHEMA ${schema} AUTHORIZATION CURRENT_USER;`)

    expect(outbox.schemaName).toMatch(/^op_automation_outbox_[a-z0-9_-]{20}$/u)
    expect(outbox.schemaName).not.toBe(ledgerSchema)
    expect(refusal).toBeGreaterThan(-1)
    expect(createSchema).toBeGreaterThan(refusal)
    expect(sql).toContain(
      'found a previously generated transactional outbox; retirement or replacement requires explicit approval'
    )
    expect(sql).toContain(`CREATE TABLE ${bindings} (`)
    expect(sql).toContain(`CREATE TABLE ${revisions} (`)
    expect(sql).toContain(`CREATE TABLE ${heads} (`)
    expect(sql).toContain('openpencil.supabase-automation-transactional-outbox.v1;application=')
    expect(sql).toContain('FROM "pg_catalog"."pg_description" AS "prior_outbox_marker"')
    expect(sql).toContain('LEFT("prior_outbox_marker"."description"')
    expect(sql).not.toContain('"prior_outbox_marker"."description" LIKE')

    expect(sql).toContain('PRIMARY KEY ("outbox_id", "revision")')
    expect(sql).toContain('PRIMARY KEY ("outbox_id")')
    expect(sql).toContain('"message_enqueued_at", "message_retention_deadline"')
    expect(sql).toContain('"business_transaction_id" text NOT NULL')
    expect(sql).toContain('"business_transaction_digest" text NOT NULL')
    expect(sql).toContain('"entity_id" text NOT NULL')
    expect(sql).toContain('"row_id_digest" text NOT NULL')
    expect(sql).toContain('"row_version" bigint NOT NULL')
    expect(sql).toContain('"event_id" text NOT NULL')
    expect(sql).toContain('"event_digest" text NOT NULL')
    expect(sql).toContain('"queue_id" text NOT NULL')
    expect(sql).toContain('"message_envelope_digest" text NOT NULL')
    expect(sql).toContain('"idempotency_key_digest" text NOT NULL')
    expect(sql).toContain('"message_enqueued_at" text NOT NULL')
    expect(sql.split('"message_retention_deadline" text NOT NULL').length - 1).toBe(2)
    expect(sql).toContain('"current_message_retention_deadline" text NOT NULL')
    expect(sql).toContain('"row_version" BETWEEN 0 AND 2147483647')
    expect(sql).toContain('"message_retention_deadline" > "message_enqueued_at"')
    expect(sql).toContain('"transition_evidence_digest" = "business_transaction_digest"')
    expect(sql).toContain('"recorded_at" <= "message_enqueued_at"')

    expect(sql).toContain('"expected_revision" = "revision" - 1')
    expect(outboxStart).toBeGreaterThan(-1)
    expect(outboxEnd).toBeGreaterThan(outboxStart)
    expect(chainStart).toBeGreaterThan(-1)
    expect(transitionStart).toBeGreaterThan(chainStart)
    for (const expectedColumn of [
      'expected_revision',
      'expected_head_digest',
      'previous_record_digest',
      'expected_publish_attempt_ids',
      'expected_current_publish_attempt_id',
      'expected_publish_attempt_ordinal',
      'expected_state',
      'expected_recorded_at',
      'expected_transition_evidence_digest'
    ]) {
      expect(chainSql).toContain(`"${expectedColumn}" IS NOT NULL`)
    }
    expect(sql).toContain('"previous_record_digest" IS NOT NULL')
    expect(sql).toContain('"previous_record_digest" = "expected_head_digest"')
    expect(sql).toContain('MATCH SIMPLE DEFERRABLE INITIALLY DEFERRED')
    expect(sql).toContain('MATCH FULL DEFERRABLE INITIALLY DEFERRED')
    expect(sql).toContain('"outbox_id", "current_revision", "current_head_digest"')
    expect(sql).toContain('"current_business_transaction_digest" text NOT NULL')
    expect(sql).toContain('"current_message_enqueued_at" text NOT NULL')
    expect(sql).toContain('"current_publish_attempt_ids" text[] NOT NULL')
    expect(sql).toContain('"current_revision", "current_head_digest"')
    expect(sql).toContain('"revision" BETWEEN 1 AND 1024')
    expect(sql).toContain('"recorded_at" > "expected_recorded_at"')
    expect(sql).toContain(
      '"transition_evidence_digest" IS DISTINCT FROM "expected_transition_evidence_digest"'
    )

    expect(sql).toContain('CREATE FUNCTION')
    expect(sql).toContain('"outbox_attempt_ids_are_valid"("attempt_ids" text[])')
    expect(sql).toContain('"pg_catalog"."cardinality"("attempt_ids") NOT BETWEEN 1 AND 20')
    expect(sql).toContain('candidate = ANY(seen_attempt_ids)')
    expect(sql).toContain('"publish_attempt_ordinal" = "pg_catalog"."cardinality"')
    expect(sql).toContain(
      '"outbox_id", "revision", "record_digest",\n    "business_transaction_digest", "message_enqueued_at",\n    "message_retention_deadline", "publish_attempt_ids",\n    "current_publish_attempt_id"'
    )
    expect(sql).toContain(
      '"business_transaction_digest", "message_enqueued_at",\n    "message_retention_deadline",\n    "expected_publish_attempt_ids", "expected_current_publish_attempt_id",'
    )
    expect(sql).toContain(
      '"current_business_transaction_digest", "current_message_enqueued_at",\n    "current_message_retention_deadline",\n    "current_publish_attempt_ids", "current_publish_attempt_id",\n    "current_publish_attempt_ordinal"'
    )
    expect(sql).toContain(
      '"current_publish_attempt_ordinal" =\n      "pg_catalog"."cardinality"("current_publish_attempt_ids")'
    )
    expect(sql).toContain('"current_publish_attempt_id" =\n      "current_publish_attempt_ids"[')
    expect(sql).toContain(
      '"publish_attempt_ids"[1:"expected_publish_attempt_ordinal"]\n            IS NOT DISTINCT FROM "expected_publish_attempt_ids"'
    )
    expect(sql).toContain('"expected_publish_attempt_ordinal" BETWEEN 1 AND 19')
    expect(sql.split('"recorded_at" < "message_retention_deadline"').length - 1).toBe(2)

    for (const state of [
      'pending',
      'pre-publish-outcome-unknown',
      'outcome-unknown',
      'known-not-published',
      'published',
      'delivered'
    ]) {
      expect(sql).toContain(`'${state}'`)
    }
    expect(sql).toContain(
      '"expected_state" = \'pending\'\n          AND "state" = \'pre-publish-outcome-unknown\''
    )
    expect(sql).toContain(
      '"expected_state" = \'known-not-published\'\n          AND "state" = \'pre-publish-outcome-unknown\''
    )
    expect(sql).toContain('"expected_state" = \'published\'\n          AND "state" = \'delivered\'')
    expect(sql).toContain('"reconciliation_evidence_digest" IS NOT NULL')
    expect(sql).toContain(
      '"publish_confirmation_evidence_digest" IS DISTINCT FROM\n                "expected_transition_evidence_digest"'
    )
    expect(sql).toContain(
      '"delivery_evidence_digest" IS DISTINCT FROM\n            "expected_transition_evidence_digest"'
    )
    expect(sql).toContain(
      '"publish_confirmation_evidence_digest" IS NOT DISTINCT FROM\n            "expected_publish_confirmation_evidence_digest"'
    )
    expect(
      sql.split(
        '"publish_confirmation_evidence_digest" IS NOT DISTINCT FROM\n                "transition_evidence_digest"'
      ).length - 1
    ).toBe(2)
    expect(sql).toContain(
      '"delivery_evidence_digest" IS NOT DISTINCT FROM\n            "transition_evidence_digest"'
    )
    expect(sql).toContain('GENERATED ALWAYS AS (COALESCE(')
    expect(sql.split('^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$').length - 1).toBeGreaterThan(20)
    expect(sql).not.toContain('^[A-Za-z0-9_-]{43}$')
    expect(sql).toContain('\\.[0-9]{9}Z$')

    expect(sql).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE ON')
    expect(sql).toContain('transactional outbox bindings and revisions are immutable')
    expect(sql).toContain('CREATE UNIQUE INDEX "outbox_revisions_transition_evidence_uidx"')
    expect(sql).toContain('COMMENT ON CONSTRAINT "outbox_revisions_transition_check"')
    expect(sql).toContain('COMMENT ON INDEX')
    expect(sql).toContain('FROM "pg_catalog"."pg_attribute" AS "table_column"')
    expect(sql).toContain('FROM "pg_catalog"."pg_constraint" AS "table_constraint"')
    expect(sql).toContain('FROM "pg_catalog"."pg_index" AS "table_index"')
    expect(sql).toContain('FROM "pg_catalog"."generate_subscripts"(')
    expect(sql).toContain('"previous_constraint"."conkey" =')
    expect(sql).toContain('"head_constraint"."conkey" =')
    expect(sql).toContain(
      'ARRAY[1, 3, 4, 17, 18, 19, 6, 7, 8, 9, 10, 11, 30, 31, 32, 33]::smallint[]'
    )
    expect(sql).toContain('ARRAY[1, 4, 5, 6]::smallint[]')
    expect(sql).toContain(
      'ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20]::smallint[]'
    )
    expect(sql).toContain(
      'ARRAY[1, 2, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 34, 35, 36, 37]::smallint[]'
    )
    expect(sql).not.toContain('ARRAY[1, 3, 4, 7, 8, 9, 10, 11, 29, 30, 31, 32]::smallint[]')
    expect(sql).toContain('A non-owner retains a direct privilege')
    expect(sql).toContain('A known Supabase API role retains effective access')
    expect(outboxSql).toContain(
      `REVOKE ALL PRIVILEGES ON SCHEMA ${schema} ${DIRECT_API_ROLE_REVOKE}`
    )
    expect(outboxSql).toContain(
      `REVOKE ALL PRIVILEGES ON TABLE ${bindings}, ${revisions}, ${heads} ${DIRECT_API_ROLE_REVOKE}`
    )
    expect(outboxSql).toContain(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${schema}."outbox_attempt_ids_are_valid"(text[]), ${schema}."reject_outbox_immutable_mutation"() ${DIRECT_API_ROLE_REVOKE}`
    )
    expect(outboxSql.split(EFFECTIVE_API_ROLE_VALUES).length - 1).toBe(3)
    expect(sql).toContain("('service' || '_role')")
    expect(sql).not.toContain('service_role')

    expect(sql).not.toContain(`INSERT INTO ${bindings}`)
    expect(sql).not.toContain(`INSERT INTO ${revisions}`)
    expect(sql).not.toContain(`UPDATE ${heads}`)
    expect(sql).not.toContain(`DELETE FROM ${revisions}`)
    expect(sql).not.toContain('CREATE POLICY')
    expect(sql).not.toContain('GRANT ')
    expect(sql).not.toContain('CREATE EXTENSION')
    expect(sql).not.toContain('https://')

    const applicationWithHyphenatedKey = {
      ...supabaseAutomationApplicationV2(),
      applicationId: 'test.supabase-automations-1'
    }
    const hyphenated = emittedArtifacts(applicationWithHyphenatedKey)
    const hyphenatedReview = JSON.parse(
      hyphenated.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.reviewManifest)
    )
    const hyphenatedSchema = hyphenatedReview.expectedPostApplyState.transactionalOutbox
      .schemaName as string
    expect(hyphenatedSchema).toContain('-')
    expect(hyphenated.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)).toContain(
      `CREATE SCHEMA "${hyphenatedSchema}" AUTHORIZATION CURRENT_USER;`
    )
  })

  test('never adopts, replaces, drops, or unschedules existing generated objects', () => {
    const result = emittedArtifacts()
    const sql = result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)
    const queueGuard = sql.indexOf(
      'OpenPencil refuses to adopt or replace a pre-existing generated queue.'
    )
    const queueCreate = sql.indexOf('PERFORM "pgmq"."create"(')
    const cronGuard = sql.indexOf(
      'OpenPencil refuses to overwrite or adopt a pre-existing Cron job.'
    )
    const cronCreate = sql.indexOf('scheduled_job_id := "cron"."schedule"(')

    expect(queueGuard).toBeGreaterThan(-1)
    expect(queueCreate).toBeGreaterThan(queueGuard)
    expect(cronGuard).toBeGreaterThan(-1)
    expect(cronCreate).toBeGreaterThan(cronGuard)
    expect(sql).toContain('retirement or replacement requires explicit approval')
    expect(sql).not.toContain('"pgmq"."drop_queue"')
    expect(sql).not.toContain('"cron"."unschedule"')
    expect(sql).not.toContain('DELETE FROM "cron"."job"')
    expect(sql).not.toContain('UPDATE "cron"."job"')
    expect(sql).not.toContain('DROP SCHEMA')
    expect(sql).not.toContain('DROP TABLE')
    expect(sql).not.toContain('DROP TRIGGER')
  })

  test('keeps queue-only extension and SQL expectations free of pg_cron', () => {
    const result = emittedArtifacts(queueOnlyApplication())
    const sql = result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.sql)
    const plan = result.plan.adapterPlans.automations as { requiredExtensions: readonly string[] }
    const review = JSON.parse(result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.reviewManifest))

    expect(plan.requiredExtensions).toEqual(['pgmq'])
    expect(review.extensions.pgCron).toBe('not-required')
    expect(review.expectedPostApplyState.idempotencyLedger).toMatchObject({
      required: false,
      schemaCandidateEmitted: false,
      schemaName: null,
      databaseApplied: false,
      evidenceStatus: 'not-required',
      hostCasWriterEmitted: false,
      transactionalOutboxIncluded: false
    })
    expect(review.expectedPostApplyState.transactionalOutbox).toMatchObject({
      required: false,
      schemaCandidateEmitted: false,
      schemaName: null,
      databaseApplied: false,
      evidenceStatus: 'not-required',
      hostCasWriterEmitted: false,
      enqueueDmlEmitted: false,
      publishDmlEmitted: false,
      ackDmlEmitted: false,
      workerEmitted: false
    })
    expect(review.blockers).not.toContain('idempotency-cas-ledger-not-applied')
    expect(review.blockers).not.toContain('idempotency-host-cas-writer-not-implemented')
    expect(review.blockers).not.toContain('transactional-outbox-not-included')
    expect(review.blockers).not.toContain('transactional-outbox-schema-not-applied')
    expect(review.blockers).not.toContain('transactional-outbox-host-cas-writer-not-implemented')
    expect(review.blockers).not.toContain(
      'transactional-outbox-business-transaction-binding-required'
    )
    expect(review.blockers).not.toContain(
      'transactional-outbox-timestamp-projection-binding-required'
    )
    expect(review.blockers).not.toContain('transactional-outbox-post-apply-receipt-not-implemented')
    expect(review.blockers).not.toContain(
      'transactional-outbox-postgrest-exposure-inventory-required'
    )
    expect(review.requiredManualChecks).not.toContain(
      'verify-transactional-outbox-timestamp-projection-preserves-instant-and-ordering'
    )
    expect(review.requiredManualChecks).not.toContain(
      'verify-transactional-outbox-postgrest-exposed-schema-inventory'
    )
    expect(sql).toContain('"extname" = \'pgmq\'')
    expect(sql).not.toContain('"extname" = \'pg_cron\'')
    expect(sql).not.toContain('"cron"."job"')
    expect(sql).not.toContain('"cron"."schedule"')
    expect(sql).not.toContain('openpencil.supabase-automation-idempotency-ledger.v1')
    expect(sql).not.toContain('idempotency_revisions')
    expect(sql).not.toContain('openpencil.supabase-automation-transactional-outbox.v1')
    expect(sql).not.toContain('outbox_revisions')
  })

  test('keeps worker, credential, network, Apply, and Deploy authority blocked', () => {
    const result = emittedArtifacts()
    const review = JSON.parse(result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.reviewManifest))
    const worker = JSON.parse(result.artifact(SUPABASE_AUTOMATION_ARTIFACT_PATHS_V2.workerContract))

    expect(review).toMatchObject({
      reviewOnly: true,
      applyAllowed: false,
      deployAllowed: false,
      releaseReady: false,
      expectedPostApplyState: {
        evidenceStatus: 'unverified-until-trusted-post-apply-receipt',
        acceptedReceipt: false,
        queueExposure: {
          dataApi: 'not-exposed',
          pgmqPublicSchema: 'not-required',
          publicRoleTableAccess: 'none',
          anonRoleTableAccess: 'none',
          authenticatedRoleTableAccess: 'none',
          serviceRoleTableAccess: 'none',
          workerAccess: 'dedicated-database-role-only'
        },
        queueShape: {
          durability: 'logged',
          partitioning: 'none',
          ownershipAndConfigurationMarker: 'exact',
          declaredRuntimeConfiguration: 'marker-only-not-database-enforced',
          completeAclInventory: 'unverified'
        },
        cron: {
          timezone: 'effective-zero-offset-UTC',
          username: 'current-user',
          database: 'current-database',
          connectionTarget: 'local-current-database-server'
        },
        idempotencyLedger: {
          required: true,
          schemaCandidateEmitted: true,
          schemaName: expect.stringMatching(/^op_automation_[a-z0-9_-]{20}$/u),
          databaseApplied: false,
          evidenceStatus: 'expected-unverified-until-trusted-post-apply-receipt',
          existingObjectPolicy: 'reject',
          ownership: 'expected-dedicated-current-user-unverified',
          tableShape: 'expected-logged-nonpartitioned-heap-unverified',
          commentsConstraintsAndIndexes: 'exact-catalog-postcondition',
          businessKey: ['automation_id', 'idempotency_key_digest'],
          initialRevision: 0,
          exactHeadCasFields: ['current_revision', 'current_head_digest'],
          revisionChain: 'expected-append-only-self-linked-unverified',
          stableRevisionBindings: [
            'event_id',
            'operation_id',
            'causation_id',
            'causation_hop',
            'retention_expires_at'
          ],
          recordedAtMonotonic: 'expected-unverified',
          revisionMutationGuard: 'expected-unverified',
          outcomeUnknownRetry: 'forbidden-until-reconciliation',
          retentionTimestamp: 'retention_expires_at',
          retentionSemantics: 'earliest-review-boundary-not-discard-authority',
          declaredRetentionAndCausationPolicy: 'host-cas-writer-and-receipt-required',
          directOrEffectiveApiRoleAccess: 'expected-none-unverified',
          hostCasWriterEmitted: false,
          cleanupRunnerEmitted: false,
          transactionalOutboxIncluded: true,
          acceptedReceipt: false
        },
        transactionalOutbox: {
          required: true,
          schemaCandidateEmitted: true,
          schemaName: expect.stringMatching(/^op_automation_outbox_[a-z0-9_-]{20}$/u),
          databaseApplied: false,
          evidenceStatus: 'expected-unverified-until-trusted-post-apply-receipt',
          existingObjectPolicy: 'reject',
          exposure: 'private-schema-api-role-access-revoked-postgrest-inventory-unverified',
          ownership: 'expected-dedicated-current-user-unverified',
          tableShape: 'expected-logged-nonpartitioned-heap-unverified',
          commentsConstraintsAndIndexes: 'exact-catalog-postcondition',
          businessKey: ['outbox_id'],
          immutableBindings: [
            'business_transaction_id',
            'business_transaction_digest',
            'entity_id',
            'row_id_digest',
            'row_version',
            'event_id',
            'event_digest',
            'queue_id',
            'message_envelope_digest',
            'idempotency_key_digest',
            'message_enqueued_at',
            'message_retention_deadline'
          ],
          initialRevision: 0,
          initialState: 'pending',
          exactHeadCasFields: ['current_revision', 'current_head_digest'],
          exactHeadSnapshotFields: [
            'current_business_transaction_digest',
            'current_message_enqueued_at',
            'current_message_retention_deadline',
            'current_publish_attempt_ids',
            'current_publish_attempt_id',
            'current_publish_attempt_ordinal',
            'current_state',
            'current_recorded_at',
            'current_transition_evidence_digest',
            'current_publish_confirmation_evidence_digest',
            'current_known_not_published_evidence_digest',
            'current_delivery_evidence_digest',
            'current_reconciliation_evidence_digest'
          ],
          revisionChain: 'expected-append-only-self-linked-unverified',
          publishAttempts: 'ordered-unique-bounded-20',
          publishAttemptHistoryBinding: 'exact-array-self-fk-and-head-revision-fk',
          recordedAtPrecision:
            'supabase-fixed-nine-utc-text-projection-not-source-byte-preservation',
          messageRetentionDeadline:
            'immutable-supabase-fixed-nine-utc-text-projection-not-source-byte-preservation',
          timestampProjectionBinding: 'host-cas-writer-and-receipt-required',
          prePublishRetentionBoundary: 'recorded-at-strictly-before-message-retention-deadline',
          outcomeUnknownRetry: 'forbidden-until-reconciliation',
          businessTransactionAtomicity: 'host-cas-writer-and-receipt-required',
          recordDigestBinding: 'host-cas-writer-and-receipt-required',
          directOrEffectiveApiRoleAccess: 'expected-none-unverified',
          hostCasWriterEmitted: false,
          enqueueDmlEmitted: false,
          publishDmlEmitted: false,
          ackDmlEmitted: false,
          cleanupRunnerEmitted: false,
          workerEmitted: false,
          acceptedReceipt: false
        }
      },
      extensions: {
        bootstrapAllowedByArtifact: false,
        inventoryVerification: 'trusted-post-apply-receipt-required',
        pgmq: 'separate-reviewed-bootstrap-prerequisite',
        pgCron: 'separate-reviewed-bootstrap-prerequisite'
      },
      retirement: {
        automatic: false,
        explicitApprovalRequired: true,
        inspectedInventoryRequired: true,
        inspectedInventoryVerified: false
      }
    })
    expect(review).not.toHaveProperty('queueExposure')
    expect(review.blockers).toEqual(
      expect.arrayContaining([
        'bounded-queue-worker-not-implemented',
        'idempotency-cas-ledger-not-applied',
        'idempotency-host-cas-writer-not-implemented',
        'idempotency-ledger-post-apply-receipt-not-implemented',
        'idempotency-ledger-retention-cleanup-not-implemented',
        'idempotency-declared-retention-and-causation-policy-binding-required',
        'transactional-outbox-schema-not-applied',
        'transactional-outbox-host-cas-writer-not-implemented',
        'transactional-outbox-business-transaction-binding-required',
        'transactional-outbox-timestamp-projection-binding-required',
        'transactional-outbox-post-apply-receipt-not-implemented',
        'transactional-outbox-postgrest-exposure-inventory-required',
        'retry-and-dead-letter-runner-not-implemented',
        'endpoint-authority-and-credential-generation-binding-required',
        'webhook-dns-and-redirect-policy-runner-not-implemented',
        'runtime-health-check-and-deployment-receipt-required',
        'extension-version-namespace-membership-inspection-receipt-required',
        'cron-connection-target-inspection-receipt-required',
        'queue-complete-acl-and-pgmq-data-api-exposure-receipt-required',
        'queue-cron-post-apply-receipt-not-implemented',
        'generated-automation-object-retirement-requires-explicit-approval'
      ])
    )
    expect(review.requiredManualChecks).toContain(
      'verify-transactional-outbox-timestamp-projection-preserves-instant-and-ordering'
    )
    expect(review.requiredManualChecks).toContain(
      'verify-transactional-outbox-postgrest-exposed-schema-inventory'
    )
    expect(worker).toMatchObject({
      reviewOnly: true,
      executableRuntimeEmitted: false,
      operationCredentialIssued: false,
      networkAuthorityCreated: false,
      databaseAuthorityCreated: false,
      queueRead: 'pgmq.read-with-visibility-timeout',
      successDisposition: 'pgmq.archive-after-idempotency-commit',
      idempotencyCommit: 'contract-only-host-cas-writer-not-emitted',
      idempotencyLedger: {
        required: true,
        schemaCandidateEmitted: true,
        schemaName: expect.stringMatching(/^op_automation_[a-z0-9_-]{20}$/u),
        databaseApplied: false,
        hostCasWriterEmitted: false,
        trustedReceiptAccepted: false,
        persistenceAuthorityCreated: false,
        retryFenceAuthorityCreated: false,
        cleanupRunnerEmitted: false,
        transactionalOutboxIncluded: true
      },
      transactionalOutbox: {
        required: true,
        schemaCandidateEmitted: true,
        schemaName: expect.stringMatching(/^op_automation_outbox_[a-z0-9_-]{20}$/u),
        databaseApplied: false,
        hostCasWriterEmitted: false,
        trustedReceiptAccepted: false,
        persistenceAuthorityCreated: false,
        dispatchAuthorityCreated: false,
        ackAuthorityCreated: false,
        cleanupRunnerEmitted: false,
        workerEmitted: false
      },
      outboundWebhookPolicy: {
        compilerSuppliedEndpointAccepted: false,
        endpointAuthority: {
          requiredHostEnvelope: 'canonical-https-endpoint-generation-and-purpose',
          replacement: 'new-generation-and-release-review-required',
          authorityCreated: false
        },
        redirects: 'forbidden',
        addressResolution: 'revalidate-every-hop',
        privateRanges: 'forbidden',
        signature: 'hmac-sha256-raw-body-v1'
      }
    })
    expect(result.emission.manifest.requiredSecrets).toHaveLength(3)
    expect(JSON.stringify(worker)).not.toContain('WEBHOOK_INGRESS_HMAC')
    expect(JSON.stringify(worker)).not.toContain('WEBHOOK_EGRESS_ENDPOINT')
    expect(JSON.stringify(worker)).not.toContain('WEBHOOK_EGRESS_HMAC')
    expect(JSON.stringify(worker)).not.toContain('https://')
  })

  test('fails closed in preview and omits server authority from source-only output', () => {
    const preview = createPlan(supabaseAutomationApplicationV2(), 'preview')
    expect(preview.result.ok).toBe(false)
    if (preview.result.ok) return
    expect(preview.result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-v2-preview-server-capability-unavailable' })
    )

    const prototype = createPlan(supabaseAutomationApplicationV2(), 'source-only-prototype')
    expect(prototype.result.ok).toBe(true)
    if (!prototype.result.ok) return
    expect(Object.keys(prototype.result.plan.adapterPlans)).toEqual(['migrations'])
    expect(
      prototype.result.plan.capabilities
        .filter((entry) => entry.capability !== 'migrations.schema')
        .every((entry) => !entry.included)
    ).toBe(true)
    expect(
      prototype.result.plan.capabilities.find((entry) => entry.capability === 'migrations.schema')
        ?.included
    ).toBe(true)
    expect(prototype.result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-v2-capability-server-bridge-omitted' })
    )
  })

  test('rejects plan tampering before artifact emission', () => {
    const planned = createPlan()
    expect(planned.result.ok).toBe(true)
    if (!planned.result.ok) return
    const plan = structuredClone(planned.result.plan)
    ;(plan.adapterPlans.automations as { applyAllowed: boolean }).applyAllowed = true
    ;(plan as { planDigest: string }).planDigest = backendProviderPlanDigestV2(plan)
    const emitted = emitBackendProviderPlanV2(planned.registry, {
      plan,
      selection: planned.selection
    })
    expect(emitted.ok).toBe(false)
    if (emitted.ok) return
    expect(emitted.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-provider-v2-plan-stale' })
    )
  })
})
