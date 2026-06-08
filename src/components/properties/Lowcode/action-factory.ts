import type {
  ActionDef,
  ActionKind,
  DocumentStateDef,
  StateDef
} from '@open-pencil/core/scene-graph'

/**
 * Phase 3 §10 v10 — shared `ActionDef` factory + kind list for the recursive
 * workflow editor (`ActionRow` / `ActionList`). Extracted from EventsPanel so
 * the same defaults seed both the top-level event chain and nested branches
 * (condition / confirm consequent/alternate, apiCall / supabase onSuccess /
 * onError).
 *
 * MCP stays the authoritative backstop: the GUI surfaces the common kinds + the
 * full control-flow structure so a user can see and fine-tune the project's
 * logic; deeply-specialised authoring still flows through the MCP tools.
 */

/** Context the factory reads for sensible field defaults. */
export interface ActionFactoryCtx {
  pageStates: readonly StateDef[]
  docStates: readonly DocumentStateDef[]
}

/** The kinds offered in the GUI kind selector. §10 v10 adds the `condition` /
 *  `confirm` control-flow kinds; §10 v11 adds `callWorkflow` (now authorable via
 *  the workflow dropdown + args editor, backed by the `WorkflowsPanel`). */
export const ACTION_KINDS: ActionKind[] = [
  'setState',
  'navigate',
  'setVariable',
  'apiCall',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  'condition',
  'confirm',
  'toast',
  'clipboard',
  'delay',
  'stop',
  'callWorkflow'
]

// Per-kind factory map — a lookup table (not a branch chain) so `makeAction`
// stays a single dispatch under the complexity gate. Each builds a fresh action
// with that kind's defaults; switching kinds discards the previous fields so the
// discriminated-union invariant holds.
/** First element typed as possibly-undefined (the lists can be empty), so the
 *  factory defaults guard against an empty document/page-state list. */
function first<T>(arr: readonly T[]): T | undefined {
  return arr[0]
}

const FACTORIES: Record<ActionKind, (id: string, ctx: ActionFactoryCtx) => ActionDef> = {
  setState: (id, ctx) => {
    const target = first(ctx.pageStates)
    return { id, kind: 'setState', targetStateId: target?.id, valueExpr: target ? `${target.name} + 1` : '' }
  },
  navigate: (id) => ({ id, kind: 'navigate', to: '/' }),
  setVariable: (id, ctx) => {
    const docTarget = first(ctx.docStates)
    return { id, kind: 'setVariable', targetName: docTarget?.name ?? '', valueExpr: docTarget ? '$prev + 1' : '' }
  },
  apiCall: (id, ctx) => ({ id, kind: 'apiCall', method: 'GET', url: '', targetName: first(ctx.docStates)?.name ?? '' }),
  supabaseQuery: (id, ctx) => ({ id, kind: 'supabaseQuery', table: '', resultTarget: first(ctx.docStates)?.name ?? '' }),
  supabaseMutation: (id) => ({ id, kind: 'supabaseMutation', operation: 'insert', table: '' }),
  supabaseAuth: (id) => ({ id, kind: 'supabaseAuth', operation: 'signIn', emailExpr: '', passwordExpr: '' }),
  // Phase 3 §10 v10 — control-flow kinds: empty branches, filled via the recursive sub-editor.
  condition: (id) => ({ id, kind: 'condition', condExpr: '', consequent: [] }),
  confirm: (id) => ({ id, kind: 'confirm', messageExpr: '"Are you sure?"', consequent: [] }),
  toast: (id) => ({ id, kind: 'toast', messageExpr: '"Done"', variant: 'info' }),
  clipboard: (id) => ({ id, kind: 'clipboard', valueExpr: '' }),
  delay: (id) => ({ id, kind: 'delay', ms: 500 }),
  stop: (id) => ({ id, kind: 'stop' }),
  // §10 v11 — a fresh callWorkflow has no target yet; the row's workflow
  // dropdown sets `workflowId` and the args editor fills `args`.
  callWorkflow: (id) => ({ id, kind: 'callWorkflow' })
}

/** Build a fresh action of `kind` with `id`. */
export function makeAction(kind: ActionKind, id: string, ctx: ActionFactoryCtx): ActionDef {
  return FACTORIES[kind](id, ctx)
}
