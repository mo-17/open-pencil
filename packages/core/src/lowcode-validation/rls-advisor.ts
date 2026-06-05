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
import type { ActionDef, WorkflowDef } from '#core/scene-graph'

/** The four Postgres RLS-relevant SQL commands a policy can target. */
export type SqlCommand = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

/** The anon-role policies one table needs, derived from document usage. */
export interface RlsTableRequirement {
  table: string
  /** Deduped, in fixed order SELECT, INSERT, UPDATE, DELETE (次默 3). */
  commands: SqlCommand[]
  /** True when the table is written (UPDATE/DELETE/upsert) — drives the
   *  footgun warning, since those are the silent-0-row cases. */
  needsWriteWarning: boolean
}

// Fixed emit order so the generated SQL (and the panel) is deterministic
// regardless of action discovery order (次默 3).
const COMMAND_ORDER: readonly SqlCommand[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']

// Decision §3.v8.2 (c): supabaseQuery → SELECT; mutation maps per operation.
// upsert needs BOTH INSERT and UPDATE — the headline footgun, an upsert
// without an anon UPDATE policy silently inserts a duplicate row.
function commandsForAction(action: ActionDef): SqlCommand[] {
  if (action.kind === 'supabaseQuery') return ['SELECT']
  if (action.kind === 'supabaseMutation') {
    switch (action.operation) {
      case 'insert':
        return ['INSERT']
      case 'update':
        return ['UPDATE']
      case 'delete':
        return ['DELETE']
      case 'upsert':
        return ['INSERT', 'UPDATE']
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
        action.kind === 'supabaseMutation'
      ) {
        out.push(...flattenActions(action.onSuccess ?? [], workflows, seen))
        out.push(...flattenActions(action.onError ?? [], workflows, seen))
      }
    }
  }
  return out
}

const EMPTY_WORKFLOWS: ReadonlyMap<string, WorkflowDef> = new Map()

/** Aggregate every Supabase action into per-table anon policy requirements.
 *  Tables are keyed by their trimmed name; blank names are skipped (次默 2).
 *  Same table referenced by multiple actions merges into one entry with the
 *  union of commands (次默 3). Phase 3 §10: descends into `condition` branches.
 *  Phase 3 §10 v4: pass `workflows` to also descend into `callWorkflow` targets
 *  (default empty = legacy behaviour, no descent). */
export function collectRlsRequirements(
  actions: ActionDef[],
  workflows: ReadonlyMap<string, WorkflowDef> = EMPTY_WORKFLOWS
): RlsTableRequirement[] {
  const byTable = new Map<string, Set<SqlCommand>>()
  for (const action of flattenActions(actions, workflows, new Set())) {
    if (action.kind !== 'supabaseQuery' && action.kind !== 'supabaseMutation') continue
    const table = action.table.trim()
    if (!table) continue
    const set = byTable.get(table) ?? new Set<SqlCommand>()
    for (const command of commandsForAction(action)) set.add(command)
    byTable.set(table, set)
  }
  return [...byTable.entries()].map(([table, set]) => ({
    table,
    commands: COMMAND_ORDER.filter((command) => set.has(command)),
    // UPDATE / DELETE (incl. upsert's UPDATE leg) are the silent-0-row
    // footgun; a pure INSERT cannot silently affect 0 rows, so it does not
    // trigger the write warning on its own.
    needsWriteWarning: set.has('UPDATE') || set.has('DELETE')
  }))
}

const PRODUCTION_REMINDER =
  '-- ⚠ replace (true) with a real predicate before production (e.g. auth.uid() = user_id)'

// Decision §3.v8.2 (d): Postgres RLS command/clause matrix (per the
// PostgreSQL CREATE POLICY docs) — SELECT and DELETE take only USING;
// INSERT takes only WITH CHECK; UPDATE takes both. Verified against the
// docs, not probeable here without a live instance → Tauri ACK #6.
function clauseFor(command: SqlCommand): string {
  if (command === 'INSERT') return 'with check (true)'
  if (command === 'UPDATE') return 'using (true) with check (true)'
  return 'using (true)' // SELECT / DELETE
}

/** Build the copy-paste SQL block for one table: enable RLS + one permissive
 *  anon/authenticated policy per required command (decisions d/e/f). */
export function buildRlsPolicySql(req: RlsTableRequirement): string {
  const t = req.table
  const lines = [PRODUCTION_REMINDER, `alter table "${t}" enable row level security;`]
  for (const command of req.commands) {
    const cmd = command.toLowerCase()
    lines.push(
      `create policy "${t}_${cmd}_anon" on "${t}" for ${cmd} to anon, authenticated ${clauseFor(command)};`
    )
  }
  return lines.join('\n')
}
