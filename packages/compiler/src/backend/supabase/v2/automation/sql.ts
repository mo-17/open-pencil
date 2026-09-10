import { digestCanonicalBackendValue } from '#compiler/backend/canonical'

import type { BackendApplicationSpecV2 } from '@open-pencil/lowcode/backend'

import { emitSupabaseAutomationIdempotencyLedgerReviewSQLV2 } from './idempotency-ledger-sql'
import {
  resolvedSupabaseAutomationsV2,
  type ResolvedSupabaseAutomationDefinitionV2,
  type ResolvedSupabaseAutomationsV2
} from './index'
import { emitSupabaseAutomationTransactionalOutboxReviewSQLV2 } from './transactional-outbox-sql'

const QUEUE_MARKER_FORMAT = 'openpencil.supabase-automation-queue.v1'
const CRON_COMMAND_MARKER_FORMAT = 'openpencil.supabase-automation-cron-command.v1'

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function generatedIdentifier(value: string, path: string): string {
  if (!/^[a-z][a-z0-9_-]{0,60}$/u.test(value)) {
    throw new TypeError(`${path} is not a bounded generated PostgreSQL identifier.`)
  }
  return value
}

interface QueueReviewDefinition {
  readonly physicalName: string
  readonly purpose: 'declared' | 'dispatch'
  readonly configurationDigest: string
}

function queueReviewDefinitions(
  resolved: ResolvedSupabaseAutomationsV2
): readonly QueueReviewDefinition[] {
  const definitions: QueueReviewDefinition[] = resolved.queues.map((queue) => ({
    physicalName: generatedIdentifier(
      queue.physicalName,
      `$.supabaseAutomations.queues.${queue.id}.physicalName`
    ),
    purpose: 'declared',
    configurationDigest: digestCanonicalBackendValue(
      {
        format: 'openpencil.supabase-automation-queue-configuration.v1',
        applicationObjectKey: resolved.applicationObjectKey,
        queueId: queue.id,
        physicalName: queue.physicalName,
        visibility: queue.visibility,
        delivery: queue.delivery,
        declaredMaxPayloadBytes: queue.maxPayloadBytes,
        declaredVisibilityTimeoutSeconds: queue.visibilityTimeoutSeconds,
        declaredRetentionSeconds: queue.retentionSeconds,
        requiredDurability: 'logged',
        requiredPartitioning: 'none'
      },
      `$.supabaseAutomations.queues.${queue.id}.configurationMarker`
    )
  }))
  if (resolved.automations.length > 0) {
    const physicalName = generatedIdentifier(
      resolved.dispatchQueueName,
      '$.supabaseAutomations.dispatchQueueName'
    )
    definitions.push({
      physicalName,
      purpose: 'dispatch',
      configurationDigest: digestCanonicalBackendValue(
        {
          format: 'openpencil.supabase-automation-queue-configuration.v1',
          applicationObjectKey: resolved.applicationObjectKey,
          physicalName,
          purpose: 'internal-dispatch',
          visibility: 'private',
          delivery: 'at-least-once',
          requiredDurability: 'logged',
          requiredPartitioning: 'none'
        },
        '$.supabaseAutomations.dispatchQueueConfigurationMarker'
      )
    })
  }
  return Object.freeze(
    definitions.sort((left, right) => left.physicalName.localeCompare(right.physicalName, 'en'))
  )
}

function queueMarkerPrefix(applicationObjectKey: string): string {
  return `${QUEUE_MARKER_FORMAT};application=${applicationObjectKey};`
}

function queueMarker(
  applicationObjectKey: string,
  queue: QueueReviewDefinition,
  tableRole: 'active' | 'archive'
): string {
  return `${queueMarkerPrefix(applicationObjectKey)}purpose=${queue.purpose};physical=${queue.physicalName};table=${tableRole};configuration-digest:${queue.configurationDigest}`
}

function queueTable(queueName: string, tableRole: 'active' | 'archive'): string {
  const prefix = tableRole === 'active' ? 'q_' : 'a_'
  return `"pgmq"."${prefix}${queueName}"`
}

function queueRelationName(queueName: string, tableRole: 'active' | 'archive'): string {
  const prefix = tableRole === 'active' ? 'q_' : 'a_'
  return `pgmq."${prefix}${queueName}"`
}

function executionRolePreflight(): readonly string[] {
  return [
    'DO $openpencil_execution_role_preflight$',
    'BEGIN',
    "  IF CURRENT_USER IN ('anon', 'authenticated', 'authenticator', 'postgres')",
    "    OR CURRENT_USER = ('service' || '_role')",
    '    OR EXISTS (',
    '      SELECT 1',
    '      FROM "pg_catalog"."pg_roles" AS "privileged_role"',
    '      WHERE ("privileged_role"."rolsuper" OR "privileged_role"."rolbypassrls")',
    '        AND "pg_catalog"."pg_has_role"(CURRENT_USER, "privileged_role"."oid", \'USAGE\')',
    '    ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OpenPencil Automation SQL requires a dedicated non-API role without superuser or BYPASSRLS authority.';",
    '  END IF;',
    'END',
    '$openpencil_execution_role_preflight$;'
  ]
}

function extensionPreflight(requiresCron: boolean): readonly string[] {
  return [
    'DO $openpencil_extension_preflight$',
    'BEGIN',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_extension" AS "required_extension"',
    '    INNER JOIN "pg_catalog"."pg_depend" AS "extension_object"',
    '      ON "extension_object"."refclassid" = \'pg_catalog.pg_extension\'::regclass',
    '      AND "extension_object"."refobjid" = "required_extension"."oid"',
    '      AND "extension_object"."deptype" = \'e\'',
    '    WHERE "required_extension"."extname" = \'pgmq\'',
    '      AND "extension_object"."classid" = \'pg_catalog.pg_proc\'::regclass',
    '      AND "extension_object"."objid" = "pg_catalog"."to_regprocedure"(\'pgmq.create(text)\')',
    '  ) OR NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_extension" AS "required_extension"',
    '    INNER JOIN "pg_catalog"."pg_depend" AS "extension_object"',
    '      ON "extension_object"."refclassid" = \'pg_catalog.pg_extension\'::regclass',
    '      AND "extension_object"."refobjid" = "required_extension"."oid"',
    '      AND "extension_object"."deptype" = \'e\'',
    '    WHERE "required_extension"."extname" = \'pgmq\'',
    '      AND "extension_object"."classid" = \'pg_catalog.pg_proc\'::regclass',
    '      AND "extension_object"."objid" = "pg_catalog"."to_regprocedure"(\'pgmq.list_queues()\')',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil requires a separately reviewed pgmq extension bootstrap with extension-owned functions in the expected schema.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_namespace" AS "forbidden_queue_api"',
    '    WHERE "forbidden_queue_api"."nspname" = \'pgmq_public\'',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil refuses queue creation while the generic pgmq Data API wrapper schema exists.';",
    '  END IF;',
    ...(requiresCron
      ? [
          '  IF NOT EXISTS (',
          '    SELECT 1',
          '    FROM "pg_catalog"."pg_extension" AS "required_extension"',
          '    INNER JOIN "pg_catalog"."pg_depend" AS "extension_object"',
          '      ON "extension_object"."refclassid" = \'pg_catalog.pg_extension\'::regclass',
          '      AND "extension_object"."refobjid" = "required_extension"."oid"',
          '      AND "extension_object"."deptype" = \'e\'',
          '    WHERE "required_extension"."extname" = \'pg_cron\'',
          '      AND "extension_object"."classid" = \'pg_catalog.pg_proc\'::regclass',
          '      AND "extension_object"."objid" = "pg_catalog"."to_regprocedure"(\'cron.schedule(text,text,text)\')',
          '  ) OR NOT EXISTS (',
          '    SELECT 1',
          '    FROM "pg_catalog"."pg_extension" AS "required_extension"',
          '    INNER JOIN "pg_catalog"."pg_depend" AS "extension_object"',
          '      ON "extension_object"."refclassid" = \'pg_catalog.pg_extension\'::regclass',
          '      AND "extension_object"."refobjid" = "required_extension"."oid"',
          '      AND "extension_object"."deptype" = \'e\'',
          '    WHERE "required_extension"."extname" = \'pg_cron\'',
          '      AND "extension_object"."classid" = \'pg_catalog.pg_class\'::regclass',
          '      AND "extension_object"."objid" = "pg_catalog"."to_regclass"(\'cron.job\')',
          '  ) THEN',
          "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil requires a separately reviewed pg_cron extension bootstrap with extension-owned objects in the expected schema.';",
          '  END IF;'
        ]
      : []),
    'END',
    '$openpencil_extension_preflight$;'
  ]
}

function priorQueueInventoryPreflight(applicationObjectKey: string): readonly string[] {
  const markerPrefix = queueMarkerPrefix(applicationObjectKey)
  return [
    'DO $openpencil_queue_inventory$',
    'BEGIN',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_class" AS "managed_queue"',
    '    INNER JOIN "pg_catalog"."pg_namespace" AS "queue_namespace"',
    '      ON "queue_namespace"."oid" = "managed_queue"."relnamespace"',
    '    WHERE "queue_namespace"."nspname" = \'pgmq\'',
    `      AND LEFT("pg_catalog"."obj_description"("managed_queue"."oid", 'pg_class'), ${markerPrefix.length}) = ${literal(markerPrefix)}`,
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil found a previously generated queue; retirement or replacement requires explicit approval and a fresh inspected inventory.';",
    '  END IF;',
    'END',
    '$openpencil_queue_inventory$;'
  ]
}

function queueCreation(
  applicationObjectKey: string,
  queue: QueueReviewDefinition
): readonly string[] {
  const queueName = literal(queue.physicalName)
  const activeTable = queueTable(queue.physicalName, 'active')
  const archiveTable = queueTable(queue.physicalName, 'archive')
  const activeRelation = literal(queueRelationName(queue.physicalName, 'active'))
  const archiveRelation = literal(queueRelationName(queue.physicalName, 'archive'))
  const activeMarker = literal(queueMarker(applicationObjectKey, queue, 'active'))
  const archiveMarker = literal(queueMarker(applicationObjectKey, queue, 'archive'))
  return [
    'DO $openpencil_queue_create$',
    'DECLARE',
    '  active_table regclass;',
    '  archive_table regclass;',
    'BEGIN',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pgmq"."list_queues"() AS "existing_queue"',
    `    WHERE "existing_queue"."queue_name" = ${queueName}`,
    `  ) OR "pg_catalog"."to_regclass"(${activeRelation}) IS NOT NULL`,
    `    OR "pg_catalog"."to_regclass"(${archiveRelation}) IS NOT NULL THEN`,
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil refuses to adopt or replace a pre-existing generated queue.';",
    '  END IF;',
    `  PERFORM "pgmq"."create"(${queueName});`,
    `  active_table := "pg_catalog"."to_regclass"(${activeRelation});`,
    `  archive_table := "pg_catalog"."to_regclass"(${archiveRelation});`,
    '  IF active_table IS NULL OR archive_table IS NULL THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pgmq did not create both expected queue tables.';",
    '  END IF;',
    '  IF (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "pg_catalog"."pg_class" AS "queue_table"',
    '    WHERE "queue_table"."oid" IN (active_table, archive_table)',
    '      AND "queue_table"."relkind" = \'r\'',
    '      AND "queue_table"."relpersistence" = \'p\'',
    '  ) <> 2 THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil requires logged, non-partitioned pgmq queue tables.';",
    '  END IF;',
    '  IF (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "pgmq"."list_queues"() AS "created_queue"',
    `    WHERE "created_queue"."queue_name" = ${queueName}`,
    '  ) <> 1 THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'pgmq queue registration postcondition failed.';",
    '  END IF;',
    'END',
    '$openpencil_queue_create$;',
    `COMMENT ON TABLE ${activeTable} IS ${activeMarker};`,
    `COMMENT ON TABLE ${archiveTable} IS ${archiveMarker};`,
    `REVOKE ALL PRIVILEGES ON TABLE ${activeTable} FROM PUBLIC, "anon", "authenticated", "authenticator";`,
    `REVOKE ALL PRIVILEGES ON TABLE ${archiveTable} FROM PUBLIC, "anon", "authenticated", "authenticator";`,
    'DO $openpencil_queue_api_role_revoke$',
    'BEGIN',
    `  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE ${activeTable} FROM ' || "pg_catalog"."quote_ident"('service' || '_role');`,
    `  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE ${archiveTable} FROM ' || "pg_catalog"."quote_ident"('service' || '_role');`,
    'END',
    '$openpencil_queue_api_role_revoke$;',
    'DO $openpencil_queue_postcondition$',
    'BEGIN',
    `  IF "pg_catalog"."obj_description"("pg_catalog"."to_regclass"(${activeRelation}), 'pg_class') IS DISTINCT FROM ${activeMarker}`,
    `    OR "pg_catalog"."obj_description"("pg_catalog"."to_regclass"(${archiveRelation}), 'pg_class') IS DISTINCT FROM ${archiveMarker} THEN`,
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil queue ownership/configuration marker postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    `      ("pg_catalog"."to_regclass"(${activeRelation})),`,
    `      ("pg_catalog"."to_regclass"(${archiveRelation}))`,
    '    ) AS "managed_table"("table_oid")',
    '    INNER JOIN "pg_catalog"."pg_class" AS "queue_table"',
    '      ON "queue_table"."oid" = "managed_table"."table_oid"',
    '    CROSS JOIN LATERAL "pg_catalog"."aclexplode"(',
    `      COALESCE("queue_table"."relacl", "pg_catalog"."acldefault"('r', "queue_table"."relowner"))`,
    '    ) AS "queue_acl"',
    '    WHERE "queue_acl"."grantee" = 0',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'PUBLIC retains a direct privilege on an OpenPencil queue table.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    `      ("pg_catalog"."to_regclass"(${activeRelation})),`,
    `      ("pg_catalog"."to_regclass"(${archiveRelation}))`,
    '    ) AS "managed_table"("table_oid")',
    "    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS \"known_role\"(\"role_name\")",
    "    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS \"table_privilege\"(\"privilege_name\")",
    '    WHERE "pg_catalog"."has_table_privilege"(',
    '      "known_role"."role_name",',
    '      "managed_table"."table_oid",',
    '      "table_privilege"."privilege_name"',
    '    )',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A known Supabase API role retains effective table privileges on an OpenPencil queue.';",
    '  END IF;',
    'END',
    '$openpencil_queue_postcondition$;'
  ]
}

function cronCommandMarker(
  applicationObjectKey: string,
  automation: ResolvedSupabaseAutomationDefinitionV2
): string {
  return `${CRON_COMMAND_MARKER_FORMAT};application=${applicationObjectKey};automation=${automation.objectKey}`
}

function cronCommand(
  applicationObjectKey: string,
  dispatchQueueName: string,
  automation: ResolvedSupabaseAutomationDefinitionV2
): readonly string[] {
  return [
    `-- ${cronCommandMarker(applicationObjectKey, automation)}`,
    'SELECT *',
    'FROM "pgmq"."send"(',
    `  ${literal(dispatchQueueName)},`,
    '  "pg_catalog"."jsonb_build_object"(',
    `    'format', 'openpencil.supabase-schedule-event.v1',`,
    `    'automationId', ${literal(automation.id)},`,
    `    'causationId', "pg_catalog"."gen_random_uuid"()::"pg_catalog"."text"`,
    '  ),',
    '  0',
    ');'
  ]
}

function scheduleStatement(
  applicationObjectKey: string,
  dispatchQueueName: string,
  automation: ResolvedSupabaseAutomationDefinitionV2
): readonly string[] {
  if (automation.trigger.kind !== 'schedule') return []
  const jobName = generatedIdentifier(
    `op_${automation.objectKey}`,
    `$.supabaseAutomations.automations.${automation.id}.jobName`
  )
  const command = cronCommand(applicationObjectKey, dispatchQueueName, automation)
  return [
    'DO $openpencil_cron_create$',
    'DECLARE',
    '  scheduled_job_id bigint;',
    '  expected_command CONSTANT text := $openpencil_job$',
    ...command,
    '$openpencil_job$;',
    'BEGIN',
    `  IF EXISTS (SELECT 1 FROM "cron"."job" WHERE "jobname" = ${literal(jobName)}) THEN`,
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil refuses to overwrite or adopt a pre-existing Cron job.';",
    '  END IF;',
    '  scheduled_job_id := "cron"."schedule"(',
    `    ${literal(jobName)},`,
    `    ${literal(automation.trigger.cron)},`,
    '    expected_command',
    '  );',
    '  IF scheduled_job_id IS NULL OR (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "cron"."job"',
    '    WHERE "jobid" = scheduled_job_id',
    `      AND "jobname" = ${literal(jobName)}`,
    '      AND "username" = CURRENT_USER',
    '      AND "database" = CURRENT_DATABASE()',
    "      AND \"nodename\" IN ('localhost', '127.0.0.1')",
    '      AND "nodeport" = "pg_catalog"."current_setting"(\'port\')::integer',
    `      AND "schedule" = ${literal(automation.trigger.cron)}`,
    '      AND "command" = expected_command',
    '      AND "active" IS TRUE',
    '  ) <> 1 THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil Cron job postcondition failed.';",
    '  END IF;',
    'END',
    '$openpencil_cron_create$;'
  ]
}

function cronPreflight(applicationObjectKey: string): readonly string[] {
  const commandMarkerPrefix = `-- ${CRON_COMMAND_MARKER_FORMAT};application=${applicationObjectKey};`
  return [
    'LOCK TABLE "cron"."job" IN SHARE ROW EXCLUSIVE MODE;',
    'DO $openpencil_cron_preflight$',
    'DECLARE',
    '  effective_timezone text := "pg_catalog"."current_setting"(\'cron.timezone\', TRUE);',
    'BEGIN',
    '  IF effective_timezone IS NULL',
    '    OR "pg_catalog"."timezone"(effective_timezone, TIMESTAMPTZ \'2024-01-15 00:00:00+00\') IS DISTINCT FROM TIMESTAMP \'2024-01-15 00:00:00\'',
    '    OR "pg_catalog"."timezone"(effective_timezone, TIMESTAMPTZ \'2024-04-15 00:00:00+00\') IS DISTINCT FROM TIMESTAMP \'2024-04-15 00:00:00\'',
    '    OR "pg_catalog"."timezone"(effective_timezone, TIMESTAMPTZ \'2024-07-15 00:00:00+00\') IS DISTINCT FROM TIMESTAMP \'2024-07-15 00:00:00\'',
    '    OR "pg_catalog"."timezone"(effective_timezone, TIMESTAMPTZ \'2024-10-15 00:00:00+00\') IS DISTINCT FROM TIMESTAMP \'2024-10-15 00:00:00\' THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil requires pg_cron to use an effective zero-offset UTC timezone.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "cron"."job"',
    `    WHERE LEFT("command", ${commandMarkerPrefix.length}) = ${literal(commandMarkerPrefix)}`,
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil found a previously generated Cron job; retirement or replacement requires explicit approval and a fresh inspected inventory.';",
    '  END IF;',
    'END',
    '$openpencil_cron_preflight$;'
  ]
}

/** Deterministic review SQL only. No caller in this package can connect, Apply, or Deploy it. */
export function emitSupabaseAutomationsReviewSQLV2(application: BackendApplicationSpecV2): string {
  const resolved = resolvedSupabaseAutomationsV2(application)
  const queues = queueReviewDefinitions(resolved)
  const schedules = resolved.automations.filter((entry) => entry.trigger.kind === 'schedule')
  const advisoryLockSubject = `openpencil.supabase-automation.v1:${resolved.applicationObjectKey}`
  const lines = [
    '-- OpenPencil Supabase automation migration review v1.',
    '-- Review only. This artifact has no credential, connection, Apply, or Deploy authority.',
    '-- Queue/Cron state is expected but unverified until a trusted post-apply Receipt accepts it.',
    '-- The idempotency ledger and transactional outbox are schema-only: no Host CAS writer, DML, cleanup, or worker is emitted.',
    '-- Existing generated objects and all retirement/replacement operations require explicit approval.',
    '-- Extension bootstrap is a separate privileged review and is never performed by this artifact.',
    'BEGIN;',
    'SET LOCAL search_path = pg_catalog;',
    `SELECT "pg_catalog"."pg_advisory_xact_lock"("pg_catalog"."hashtextextended"(${literal(advisoryLockSubject)}, 0::bigint));`,
    ...executionRolePreflight(),
    ...extensionPreflight(schedules.length > 0),
    ...(resolved.automations.length > 0
      ? emitSupabaseAutomationIdempotencyLedgerReviewSQLV2(resolved.applicationObjectKey)
      : []),
    ...(resolved.automations.length > 0
      ? emitSupabaseAutomationTransactionalOutboxReviewSQLV2(resolved.applicationObjectKey)
      : []),
    ...(schedules.length > 0 ? cronPreflight(resolved.applicationObjectKey) : []),
    ...priorQueueInventoryPreflight(resolved.applicationObjectKey),
    ...queues.flatMap((queue) => queueCreation(resolved.applicationObjectKey, queue)),
    ...schedules.flatMap((automation) =>
      scheduleStatement(resolved.applicationObjectKey, resolved.dispatchQueueName, automation)
    ),
    'COMMIT;',
    ''
  ]
  return lines.join('\n')
}
