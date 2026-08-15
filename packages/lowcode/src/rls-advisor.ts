/**
 * Phase 3 §3.v8 — Supabase RLS policy advisor (static, usage-driven).
 *
 * Closes §3.8 surprise #5: when the anon role lacks an UPDATE/DELETE policy
 * a PATCH/DELETE returns HTTP 204 with 0 rows changed (looks like a missing
 * id), and an upsert silently falls back to INSERT (creating duplicate
 * rows). That footgun is NOT reliably detectable through the anon REST API
 * — PostgREST returns the same 204 / `[]` for both "RLS blocked all rows"
 * and "0 rows matched" — so instead of a live probe (which would also need
 * a running Supabase instance to verify its semantics), this module derives
 * the policies a document *needs* purely from the Supabase actions it uses
 * and renders copy-paste SQL.
 *
 * Pure logic, fully unit-testable: the input is the already-collected list
 * of `ActionDef`s (the editor panel walks the scene graph and feeds them
 * in), so this stays framework-agnostic and only `import type`s the action
 * shapes. Single source of truth (经验 I), same pattern as §3.v3
 * `supabase-payload-entries.ts` / §3.v7 `datepicker-props.ts`.
 *
 * Decision §3.v8.2 (f): the generated predicate is `(true)` (fully
 * permissive) — the fastest way to unblock the silent-0-row footgun — with
 * a prominent "replace before production" comment, because the real
 * predicate is business-specific and cannot be inferred. This deliberately
 * does NOT auto-generate ownership predicates; see §2 decision (j) for the
 * "no RLS = wide open" security warning this comment echoes.
 */
import type { ActionDef, WorkflowDef } from '@open-pencil/scene-graph'

/** The four Postgres RLS-relevant SQL commands a policy can target. */
export type SqlCommand = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

/** The anon-role policies one table needs, derived from document usage. */
export interface RlsTableRequirement {
  /** Database schema. Defaults to `public` for legacy callers. */
  schema?: string
  table: string
  /** Deduped, in fixed order SELECT, INSERT, UPDATE, DELETE (次默 3). */
  commands: SqlCommand[]
  /** True when the table is written (UPDATE/DELETE/upsert) — drives the
   *  footgun warning, since those are the silent-0-row cases. */
  needsWriteWarning: boolean
  /** Supabase Storage uploads target `storage.objects`; when present, generated
   * SQL is restricted to this bucket instead of using a `(true)` predicate. */
  storageBucket?: string
}

/** Non-ActionDef Supabase reads that are encoded in interactiveProps. */
export interface RlsListQueryUsage {
  table: string
}

/** Supabase Storage uploads encoded in an INPUT's interactiveProps. */
export interface RlsStorageUploadUsage {
  bucket: string
}

export interface RlsCollectionOptions {
  /** Default schema for table actions and LIST data sources. */
  schema?: string
  listQueries?: readonly RlsListQueryUsage[]
  storageUploads?: readonly RlsStorageUploadUsage[]
}

// Fixed emit order so the generated SQL (and the panel) is deterministic
// regardless of action discovery order (次默 3).
const COMMAND_ORDER: readonly SqlCommand[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']

// Decision §3.v8.2 (c): supabaseQuery → SELECT; mutation maps per operation.
// UPDATE and filtered DELETE also need SELECT under Supabase/PostgREST RLS.
// Upsert therefore needs SELECT + INSERT + UPDATE; omitting a required read
// policy can make a mutation appear to succeed while changing no row.
function commandsForAction(action: ActionDef): SqlCommand[] {
  if (action.kind === 'supabaseQuery') return ['SELECT']
  if (action.kind === 'supabaseMutation') {
    switch (action.operation) {
      case 'insert':
        return ['INSERT']
      case 'update':
        return ['SELECT', 'UPDATE']
      case 'delete':
        return ['SELECT', 'DELETE']
      case 'upsert':
        return ['SELECT', 'INSERT', 'UPDATE']
    }
  }
  return []
}

/** Phase 3 §10 / §10 v3: a `condition` or `confirm` action nests `consequent` /
 *  `alternate` ActionDef chains that may themselves contain Supabase actions.
 *  Flatten the workflow tree so RLS requirements from inside branches are not
 *  silently missed (经验 A). Phase 3 §10 v4: a `callWorkflow` action descends
 *  into its referenced workflow's chain (when `workflows` is supplied), guarded
 *  by `seen` against cycles. Phase 3 §10 v9: an apiCall / supabase action nests
 *  `onSuccess` / `onError` result-branches that may also contain Supabase
 *  actions — descend into those too (the action itself is still emitted). */
function flattenActions(
  actions: ActionDef[],
  workflows: ReadonlyMap<string, WorkflowDef>,
  seen: Set<string>
): ActionDef[] {
  const out: ActionDef[] = []
  for (const action of actions) {
    if (action.kind === 'condition' || action.kind === 'confirm') {
      out.push(...flattenActions(action.consequent, workflows, seen))
      out.push(...flattenActions(action.alternate ?? [], workflows, seen))
    } else if (action.kind === 'callWorkflow') {
      const id = action.workflowId
      const wf = typeof id === 'string' ? workflows.get(id) : undefined
      if (wf && !seen.has(wf.id)) {
        seen.add(wf.id)
        out.push(...flattenActions(wf.actions, workflows, seen))
        seen.delete(wf.id)
      }
    } else {
      out.push(action)
      if (
        action.kind === 'apiCall' ||
        action.kind === 'supabaseQuery' ||
        action.kind === 'supabaseMutation' ||
        action.kind === 'invokeServerWorkflow'
      ) {
        out.push(...flattenActions(action.onSuccess ?? [], workflows, seen))
        out.push(...flattenActions(action.onError ?? [], workflows, seen))
      }
    }
  }
  return out
}

const EMPTY_WORKFLOWS: ReadonlyMap<string, WorkflowDef> = new Map()

interface RequirementAccumulator {
  schema: string
  table: string
  commands: Set<SqlCommand>
  storageBucket?: string
}

function normalizedSchema(schema: string | undefined): string {
  return schema?.trim() || 'public'
}

function addRequirement(
  byResource: Map<string, RequirementAccumulator>,
  schema: string,
  table: string,
  commands: readonly SqlCommand[],
  storageBucket?: string
): void {
  const normalizedTable = table.trim()
  const normalizedBucket = storageBucket?.trim()
  if (!normalizedTable || (storageBucket !== undefined && !normalizedBucket)) return
  const key = JSON.stringify([schema, normalizedTable, normalizedBucket ?? null])
  const entry = byResource.get(key) ?? {
    schema,
    table: normalizedTable,
    commands: new Set<SqlCommand>(),
    ...(normalizedBucket ? { storageBucket: normalizedBucket } : {})
  }
  for (const command of commands) entry.commands.add(command)
  byResource.set(key, entry)
}

/** Aggregate every Supabase action into per-table anon policy requirements.
 *  Tables are keyed by their trimmed name; blank names are skipped (次默 2).
 *  Same table referenced by multiple actions merges into one entry with the
 *  union of commands (次默 3). Phase 3 §10: descends into `condition` branches.
 *  Phase 3 §10 v4: pass `workflows` to also descend into `callWorkflow` targets
 *  (default empty = legacy behaviour, no descent). */
export function collectRlsRequirements(
  actions: ActionDef[],
  workflows: ReadonlyMap<string, WorkflowDef> = EMPTY_WORKFLOWS,
  options: RlsCollectionOptions = {}
): RlsTableRequirement[] {
  const schema = normalizedSchema(options.schema)
  const byResource = new Map<string, RequirementAccumulator>()
  for (const action of flattenActions(actions, workflows, new Set())) {
    if (action.kind !== 'supabaseQuery' && action.kind !== 'supabaseMutation') continue
    addRequirement(byResource, schema, action.table, commandsForAction(action))
  }
  for (const query of options.listQueries ?? []) {
    addRequirement(byResource, schema, query.table, ['SELECT'])
  }
  for (const upload of options.storageUploads ?? []) {
    // The generated INPUT runtime uploads with `{ upsert: true }`. Supabase
    // Storage requires INSERT for a new object and SELECT + UPDATE for upsert.
    addRequirement(byResource, 'storage', 'objects', ['SELECT', 'INSERT', 'UPDATE'], upload.bucket)
  }
  return [...byResource.values()].map(({ schema, table, commands, storageBucket }) => ({
    schema,
    table,
    commands: COMMAND_ORDER.filter((command) => commands.has(command)),
    // UPDATE / DELETE (incl. upsert's UPDATE leg) are the silent-0-row
    // footgun; a pure INSERT cannot silently affect 0 rows, so it does not
    // trigger the write warning on its own.
    needsWriteWarning: commands.has('UPDATE') || commands.has('DELETE'),
    ...(storageBucket ? { storageBucket } : {})
  }))
}

const PRODUCTION_REMINDER =
  '-- ⚠ replace (true) with a real predicate before production (e.g. auth.uid() = user_id)'

// Decision §3.v8.2 (d): Postgres RLS command/clause matrix (per the
// PostgreSQL CREATE POLICY docs) — SELECT and DELETE take only USING;
// INSERT takes only WITH CHECK; UPDATE takes both. Verified against the
// docs, not probeable here without a live instance → Tauri ACK #6.
function clauseFor(command: SqlCommand, predicate: string): string {
  if (command === 'INSERT') return `with check (${predicate})`
  if (command === 'UPDATE') return `using (${predicate}) with check (${predicate})`
  return `using (${predicate})` // SELECT / DELETE
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Build the copy-paste SQL block for one table: enable RLS + one permissive
 *  anon/authenticated policy per required command (decisions d/e/f). */
export function buildRlsPolicySql(req: RlsTableRequirement): string {
  const schema = normalizedSchema(req.schema)
  const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(req.table)}`
  const predicate = req.storageBucket ? `bucket_id = ${quoteLiteral(req.storageBucket)}` : 'true'
  const lines = [
    req.storageBucket
      ? '-- Review bucket access roles and ownership rules before production.'
      : PRODUCTION_REMINDER,
    `alter table ${qualifiedTable} enable row level security;`
  ]
  for (const command of req.commands) {
    const cmd = command.toLowerCase()
    const policyName = [schema, req.table, req.storageBucket, cmd, 'openpencil']
      .filter((part): part is string => !!part)
      .join('_')
    lines.push(
      `create policy ${quoteIdentifier(policyName)} on ${qualifiedTable} for ${cmd} to anon, authenticated ${clauseFor(command, predicate)};`
    )
  }
  return lines.join('\n')
}
