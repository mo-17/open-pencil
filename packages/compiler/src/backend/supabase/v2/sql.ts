import type { BackendApplicationSpecV2, BackendRealtimeEvent } from '@open-pencil/lowcode/backend'

import {
  resolvedSupabasePrivateRealtimeSubscriptionsV2,
  SUPABASE_PRIVATE_REALTIME_EVENT_V2,
  SUPABASE_PRIVATE_REALTIME_SCHEMA_V2,
  type ResolvedSupabasePrivateRealtimeSubscriptionV2
} from './realtime'

const EVENT_ORDER = Object.freeze([
  'insert',
  'update',
  'delete'
] as const satisfies readonly BackendRealtimeEvent[])

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function primaryKeyJSON(
  subscription: ResolvedSupabasePrivateRealtimeSubscriptionV2,
  row: 'NEW' | 'OLD'
): string {
  const args = subscription.primaryKey.flatMap(({ field }) => [
    quoteLiteral(field),
    `"pg_catalog"."to_jsonb"(${row}.${quoteIdentifier(field)})`
  ])
  return `"pg_catalog"."jsonb_build_object"(${args.join(', ')})`
}

function payloadSQL(
  subscription: ResolvedSupabasePrivateRealtimeSubscriptionV2,
  operation: BackendRealtimeEvent,
  row: 'NEW' | 'OLD'
): string {
  return `"pg_catalog"."jsonb_build_object"('entityId', ${quoteLiteral(subscription.entityId)}, 'operation', '${operation}', 'primaryKey', ${primaryKeyJSON(subscription, row)})`
}

function sendSQL(
  subscription: ResolvedSupabasePrivateRealtimeSubscriptionV2,
  operation: BackendRealtimeEvent,
  row: 'NEW' | 'OLD'
): readonly string[] {
  return [
    '    PERFORM "realtime"."send"(',
    `      ${payloadSQL(subscription, operation, row)},`,
    `      '${SUPABASE_PRIVATE_REALTIME_EVENT_V2}',`,
    `      ${quoteLiteral(subscription.topicPrefix)} || ${row}.${quoteIdentifier(subscription.ownerField)}::text,`,
    '      true',
    '    );'
  ]
}

function operationSQL(
  subscription: ResolvedSupabasePrivateRealtimeSubscriptionV2,
  operation: BackendRealtimeEvent
): readonly string[] {
  const guardRow = operation === 'delete' ? 'OLD' : 'NEW'
  const lines = [
    `  IF TG_OP = '${operation.toUpperCase()}' THEN`,
    `    IF ${guardRow}.${quoteIdentifier(subscription.ownerField)} IS NULL THEN`,
    "      RAISE EXCEPTION 'OpenPencil Realtime owner identity must not be null' USING ERRCODE = '23502';",
    '    END IF;'
  ]
  if (operation !== 'update') {
    lines.push(...sendSQL(subscription, operation, guardRow), '    RETURN NULL;', '  END IF;')
    return lines
  }
  lines.push(
    `    IF OLD.${quoteIdentifier(subscription.ownerField)} IS NULL THEN`,
    "      RAISE EXCEPTION 'OpenPencil Realtime owner identity must not be null' USING ERRCODE = '23502';",
    '    END IF;',
    `    IF OLD.${quoteIdentifier(subscription.ownerField)} IS DISTINCT FROM NEW.${quoteIdentifier(subscription.ownerField)} THEN`,
    ...sendSQL(subscription, operation, 'OLD').map((line) => `  ${line}`),
    ...sendSQL(subscription, operation, 'NEW').map((line) => `  ${line}`),
    '    ELSE',
    ...sendSQL(subscription, operation, 'NEW').map((line) => `  ${line}`),
    '    END IF;',
    '    RETURN NULL;',
    '  END IF;'
  )
  return lines
}

function operationsSQL(
  subscription: ResolvedSupabasePrivateRealtimeSubscriptionV2
): readonly string[] {
  return EVENT_ORDER.filter((event) => subscription.events.includes(event)).flatMap((event) =>
    operationSQL(subscription, event)
  )
}

function subscriptionSQL(
  subscription: ResolvedSupabasePrivateRealtimeSubscriptionV2
): readonly string[] {
  // Object identity stays stable across behavior changes; topics retain the full behavior digest.
  const identifierSuffix = `${subscription.applicationObjectKey}_${subscription.subscriptionObjectKey}`
  const functionName = quoteIdentifier(`oprtf_${identifierSuffix}`)
  const triggerName = quoteIdentifier(`oprtt_${identifierSuffix}`)
  const policyName = quoteIdentifier(`oprtp_${identifierSuffix}`)
  const functionPath = `${quoteIdentifier(SUPABASE_PRIVATE_REALTIME_SCHEMA_V2)}.${functionName}`
  const table = `${quoteIdentifier('public')}.${quoteIdentifier(subscription.table)}`
  const operations = EVENT_ORDER.filter((event) => subscription.events.includes(event))
    .map((event) => event.toUpperCase())
    .join(' OR ')
  return [
    `-- Subscription ${quoteIdentifier(subscription.id)} (${subscription.digest}).`,
    `CREATE POLICY ${policyName}`,
    'ON "realtime"."messages"',
    'FOR SELECT',
    'TO "authenticated"',
    'USING (',
    '  "realtime"."messages"."extension" = \'broadcast\'',
    `  AND (SELECT "realtime"."topic"()) = (${quoteLiteral(subscription.topicPrefix)} || (SELECT "auth"."uid"())::text)`,
    ');',
    '',
    `CREATE OR REPLACE FUNCTION ${functionPath}()`,
    'RETURNS trigger',
    'LANGUAGE plpgsql',
    'SECURITY DEFINER',
    "SET search_path = ''",
    'AS $openpencil$',
    'BEGIN',
    ...operationsSQL(subscription),
    '  RETURN NULL;',
    'END;',
    '$openpencil$;',
    `REVOKE ALL ON FUNCTION ${functionPath}() FROM PUBLIC, "anon", "authenticated";`,
    '',
    `CREATE TRIGGER ${triggerName}`,
    `AFTER ${operations} ON ${table}`,
    'FOR EACH ROW',
    `EXECUTE FUNCTION ${functionPath}();`,
    ''
  ]
}

export function emitSupabasePrivateRealtimeSQLV2(application: BackendApplicationSpecV2): string {
  const subscriptions = resolvedSupabasePrivateRealtimeSubscriptionsV2(application)
  const applicationObjectKey = subscriptions[0]?.applicationObjectKey
  if (!applicationObjectKey) {
    throw new TypeError('Supabase private Realtime SQL requires at least one subscription.')
  }
  const functionPrefix = `oprtf_${applicationObjectKey}_`
  const triggerPrefix = `oprtt_${applicationObjectKey}_`
  const policyPrefix = `oprtp_${applicationObjectKey}_`
  const lines = [
    '-- OpenPencil Supabase private Realtime Broadcast review artifact v1.',
    '-- REVIEW ONLY: this compiler has no Apply, credential, network, or deployment authority.',
    '-- Prerequisite: the managed public tables and declared owner SELECT policies already exist.',
    '-- This artifact never creates or alters objects in the locked realtime schema.',
    '-- Single apply only: existing OpenPencil-managed Realtime objects hard-block this SQL.',
    '-- Declaration changes require an independently reviewed cleanup/delta migration.',
    '-- Realtime public access must be disabled in the Supabase dashboard before release.',
    'BEGIN;',
    'DO $openpencil_drift$',
    'BEGIN',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_proc" AS managed_function',
    '    JOIN "pg_catalog"."pg_namespace" AS managed_namespace',
    '      ON managed_namespace."oid" = managed_function."pronamespace"',
    `    WHERE managed_namespace."nspname" = ${quoteLiteral(SUPABASE_PRIVATE_REALTIME_SCHEMA_V2)}`,
    `      AND "pg_catalog"."left"(managed_function."proname", ${functionPrefix.length}) = ${quoteLiteral(functionPrefix)}`,
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_trigger" AS managed_trigger',
    '    WHERE NOT managed_trigger."tgisinternal"',
    `      AND "pg_catalog"."left"(managed_trigger."tgname", ${triggerPrefix.length}) = ${quoteLiteral(triggerPrefix)}`,
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_policy" AS managed_policy',
    '    JOIN "pg_catalog"."pg_class" AS managed_relation',
    '      ON managed_relation."oid" = managed_policy."polrelid"',
    '    JOIN "pg_catalog"."pg_namespace" AS managed_namespace',
    '      ON managed_namespace."oid" = managed_relation."relnamespace"',
    '    WHERE managed_namespace."nspname" = \'realtime\'',
    '      AND managed_relation."relname" = \'messages\'',
    `      AND "pg_catalog"."left"(managed_policy."polname", ${policyPrefix.length}) = ${quoteLiteral(policyPrefix)}`,
    '  ) THEN',
    "    RAISE EXCEPTION 'Existing OpenPencil Realtime objects require a reviewed cleanup or delta migration';",
    '  END IF;',
    'END;',
    '$openpencil_drift$;',
    '',
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(SUPABASE_PRIVATE_REALTIME_SCHEMA_V2)} AUTHORIZATION CURRENT_USER;`,
    'DO $openpencil_owner$',
    'BEGIN',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_namespace" AS managed_namespace',
    '    JOIN "pg_catalog"."pg_roles" AS schema_owner',
    '      ON schema_owner."oid" = managed_namespace."nspowner"',
    `    WHERE managed_namespace."nspname" = ${quoteLiteral(SUPABASE_PRIVATE_REALTIME_SCHEMA_V2)}`,
    '      AND schema_owner."rolname" = CURRENT_USER',
    '  ) THEN',
    "    RAISE EXCEPTION 'OpenPencil private schema must be owned by the current trusted migration role';",
    '  END IF;',
    'END;',
    '$openpencil_owner$;',
    `REVOKE ALL ON SCHEMA ${quoteIdentifier(SUPABASE_PRIVATE_REALTIME_SCHEMA_V2)} FROM PUBLIC, "anon", "authenticated";`,
    '',
    ...subscriptions.flatMap(subscriptionSQL),
    'COMMIT;'
  ]
  return `${lines.join('\n').trimEnd()}\n`
}
