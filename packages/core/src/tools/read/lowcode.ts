import { cloneMotionSpec } from '@open-pencil/scene-graph'
import type {
  ActionDef,
  AnalyticsConfig,
  BindingExpr,
  DocumentStateDef,
  EventName,
  LowcodeHeadMetadata,
  LayoutMode,
  LowcodeTranslations,
  MotionSpec,
  SeoMetadata,
  StateDef,
  StateOverrides,
  SupabaseConfig,
  WorkflowDef
} from '@open-pencil/scene-graph'

/**
 * Phase 3 §3 step 2 — lowcode read tools.
 *
 * Three tools so AI agents (and the MCP server / CLI eval) can see the
 * lowcode side of a document: per-node interactive wiring + the root-level
 * doc-state declarations + the root-level Supabase connection config. The
 * matching modify tools live in `tools/modify/lowcode.ts` (step 3); these
 * are the read counterparts and never mutate.
 *
 * Return shape is `{ ok: true; data: ... } | { ok: false; error: string }`
 * across all six lowcode tools (decision §3.2 #e) so AI prompts can rely
 * on one consistent unwrap rather than the bare-data convention the rest
 * of `tools/read/**` uses.
 */
import type { FigmaAPI } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

import { summarizeMotion, type MotionSummary } from './motion'

/** Read shape returned by `readLowcodeNode`. Every lowcode field stays
 *  optional — a node with no wiring returns just `id` / `type` / `name`,
 *  matching how the SceneNode itself stores these (all `?:`). The shape
 *  is non-recursive (decision §3.2 #a): children of the node are not
 *  included; AI walks the tree with subsequent `readLowcodeNode` calls. */
export interface LowcodeNodeRead {
  id: string
  type: string
  name: string
  /** Auto-layout mode; `'FREE'` means the Phase 2 §6 freeLayout override
   *  is on, which is the only lowcode-relevant layout signal. Other
   *  values (`'NONE'` / `'HORIZONTAL'` / `'VERTICAL'`) are pencil-design
   *  domain and reported as-is for completeness. */
  layoutMode: LayoutMode
  /** Page-scoped state declarations (Phase 0). Only set on the page CANVAS
   *  in practice, but the field exists on every SceneNode. */
  state?: StateDef[]
  /** Channel → expression bindings (Phase 1 §7.3). Keys are channel names
   *  like `text` / `className` / `src`; values are the discriminated
   *  `BindingExpr` union (kind: `'state'` / `'docState'` / `'expr'`). */
  bindings?: Record<string, BindingExpr>
  /** Event handlers per event name. Each entry is an ordered list of
   *  ActionDef instances; order is preserved through emit. */
  events?: Partial<Record<EventName, ActionDef[]>>
  /** Free-form property bag for interactive components (Phase 1 §10).
   *  Keys depend on `type` — e.g. BUTTON has `text`, INPUT has `placeholder`. */
  interactiveProps?: Record<string, unknown>
  /** Conditional-render expression (Phase 2 §9). Empty string / undefined
   *  → unconditional render. Sub-language matches §7.3 valueExpr. */
  renderCondition?: string
  /** Phase 4 §20: per-interaction-state appearance overrides, emitted as
   *  Tailwind pseudo-state classes (`hover:*`, `focus:*`, ...). */
  stateOverrides?: StateOverrides
  /** Declarative bounded MotionSpec v1/v2 plus a compact indexable summary. */
  motion?: MotionSpec
  motionSummary?: MotionSummary
  /** Root-only: document-level state declarations. Always undefined on
   *  non-root nodes (decision §2.2 #a); use `readDocStates` for the
   *  canonical access. */
  lowcodeDocumentState?: DocumentStateDef[]
  /** Root-only: Supabase connection config. Always undefined on
   *  non-root nodes; use `readSupabaseConfig` for the canonical access. */
  lowcodeSupabaseConfig?: SupabaseConfig
  /** Root defaults or page override: static HTML SEO metadata used by the
   *  compiler when CompilerOptions.metadata does not override it. */
  lowcodeSeoMetadata?: SeoMetadata
  /** Root-only: analytics provider config for generated lowcode output. */
  lowcodeAnalyticsConfig?: AnalyticsConfig
  /** Root-only: controlled custom head metadata for generated lowcode output. */
  lowcodeHeadMetadata?: LowcodeHeadMetadata
  /** Root-only: custom CSS appended to generated `src/index.css`. */
  lowcodeCustomCss?: string
  /** Root-only: document-level translation catalog (Phase 3 §9 v7). Always
   *  undefined on non-root nodes; use `readTranslations` for the canonical
   *  access. */
  lowcodeTranslations?: LowcodeTranslations
  /** Root-only: document-level named workflows (Phase 3 §10 v4). Always
   *  undefined on non-root nodes; use `readWorkflows` for the canonical
   *  access. */
  lowcodeWorkflows?: WorkflowDef[]
}

type ReadResult<T> = { ok: true; data: T } | { ok: false; error: string }

function buildLowcodeRead(node: {
  id: string
  type: string
  name: string
  layoutMode: LayoutMode
  state?: StateDef[]
  bindings?: Record<string, BindingExpr>
  events?: Partial<Record<EventName, ActionDef[]>>
  interactiveProps?: Record<string, unknown>
  renderCondition?: string
  stateOverrides?: StateOverrides
  motion?: MotionSpec
  lowcodeDocumentState?: DocumentStateDef[]
  lowcodeSupabaseConfig?: SupabaseConfig
  lowcodeSeoMetadata?: SeoMetadata
  lowcodeAnalyticsConfig?: AnalyticsConfig
  lowcodeHeadMetadata?: LowcodeHeadMetadata
  lowcodeCustomCss?: string
  lowcodeTranslations?: LowcodeTranslations
  lowcodeWorkflows?: WorkflowDef[]
}): LowcodeNodeRead {
  const out: LowcodeNodeRead = {
    id: node.id,
    type: node.type,
    name: node.name,
    layoutMode: node.layoutMode
  }
  if (node.state !== undefined) out.state = node.state
  if (node.bindings !== undefined) out.bindings = node.bindings
  if (node.events !== undefined) out.events = node.events
  if (node.interactiveProps !== undefined) out.interactiveProps = node.interactiveProps
  if (node.renderCondition !== undefined) out.renderCondition = node.renderCondition
  if (node.stateOverrides !== undefined) out.stateOverrides = node.stateOverrides
  if (node.motion !== undefined) {
    out.motion = cloneMotionSpec(node.motion)
    out.motionSummary = summarizeMotion(out.motion)
  }
  if (node.lowcodeDocumentState !== undefined) out.lowcodeDocumentState = node.lowcodeDocumentState
  if (node.lowcodeSupabaseConfig !== undefined)
    out.lowcodeSupabaseConfig = node.lowcodeSupabaseConfig
  if (node.lowcodeSeoMetadata !== undefined) out.lowcodeSeoMetadata = node.lowcodeSeoMetadata
  if (node.lowcodeAnalyticsConfig !== undefined)
    out.lowcodeAnalyticsConfig = node.lowcodeAnalyticsConfig
  if (node.lowcodeHeadMetadata !== undefined) out.lowcodeHeadMetadata = node.lowcodeHeadMetadata
  if (node.lowcodeCustomCss !== undefined) out.lowcodeCustomCss = node.lowcodeCustomCss
  if (node.lowcodeTranslations !== undefined) out.lowcodeTranslations = node.lowcodeTranslations
  if (node.lowcodeWorkflows !== undefined) out.lowcodeWorkflows = node.lowcodeWorkflows
  return out
}

function getRoot(figma: FigmaAPI) {
  return figma.graph.getNode(figma.graph.rootId)
}

export const readLowcodeNode = defineTool({
  name: 'read_lowcode_node',
  description:
    "Read the lowcode-specific fields of a single SceneNode: state declarations, channel bindings, event handlers, interactive component props, stateOverrides, renderCondition, layoutMode, and declarative MotionSpec v1/v2 (full bounded spec plus compact motionSummary), together with root-only documentState / supabaseConfig snapshots. Fields stored as undefined are omitted so AI can distinguish 'never configured' from an authored empty value. Non-recursive — children are not included; call again per child id. Use read_motion for a focused motion read. Failure shape: { ok: false, error: <reason> } when the id does not match any node.",
  params: {
    id: { type: 'string', description: 'Node id', required: true }
  },
  execute: (figma, { id }): ReadResult<LowcodeNodeRead> => {
    const node = figma.graph.getNode(id)
    if (!node) return { ok: false, error: `Node "${id}" not found` }
    return { ok: true, data: buildLowcodeRead(node) }
  }
})

export const readDocStates = defineTool({
  name: 'read_doc_states',
  description:
    "Read the document-level state declarations stored on the root node (`root.lowcodeDocumentState`). These are Bubble-style runtime variables (name + type + default) shared across every page in the compiled output and exposed to emitted React code via the `_lowcode_state.ts` runtime as `useDocState(name)` / `setDocState(name, value)`. When supabaseConfig is also set, the IR collect step auto-prepends a built-in `$currentUser` doc-state ({ id, email, signedIn }) here — it appears in the read result so AI prompts can see the reserved-prefix convention in action without poking at compiler internals. Always returns { ok: true, data: [...] }: missing root or missing field both surface as the empty array. Example: read_doc_states() → { ok: true, data: [{ id: 'd-1', name: 'count', type: 'number', defaultValue: 0 }, { id: 'd-2', name: '$currentUser', type: 'object', defaultValue: { id: null, email: null, signedIn: false } }] }.",
  params: {},
  execute: (figma): ReadResult<DocumentStateDef[]> => {
    const root = getRoot(figma)
    return { ok: true, data: root?.lowcodeDocumentState ?? [] }
  }
})

export const readSupabaseConfig = defineTool({
  name: 'read_supabase_config',
  description:
    "Read the Supabase connection config stored on the root node (`root.lowcodeSupabaseConfig`). Returns the full SupabaseConfig including anon key — the editor + AI both operate inside the trust boundary, and the anon key is a public token by Supabase's RLS design (per Phase 3 §2.2 #2). Service_role keys are rejected at the write path (set_supabase_config) so they cannot land in this read either. Use this to determine whether the document has Supabase wired up at all (null → no config) and which url / anonKey / optional schema the emitted runtime will splice into `_lowcode_supabase.ts`. Always returns { ok: true, data: ... }; data is null when the config is absent so AI prompts can branch on a single property. Example: read_supabase_config() → { ok: true, data: { url: 'https://abc.supabase.co', anonKey: 'eyJ…anon…' } } or { ok: true, data: null }.",
  params: {},
  execute: (figma): ReadResult<SupabaseConfig | null> => {
    const root = getRoot(figma)
    return { ok: true, data: root?.lowcodeSupabaseConfig ?? null }
  }
})

export const readTranslations = defineTool({
  name: 'read_translations',
  description:
    "Read the document-level translation catalog stored on the root node (`root.lowcodeTranslations`, Phase 3 §9 v7). Shape: { <localeCode>: { <sourceMessage>: <translatedString> } } — keyed by the SOURCE message string (the visible canvas text / ICU canonical message), which is what `set_translations` accepts and what the compiler matches against to pre-fill each target `src/locales/<locale>.json` (missing entries fall back to the source string). Use this to see which locales have authored translations and how complete each is before a compile with i18n enabled. Always returns { ok: true, data: ... }; data is {} when no translations are authored so AI prompts can branch on a single property. Example: read_translations() → { ok: true, data: { fr: { 'Submit': 'Envoyer' } } } or { ok: true, data: {} }.",
  params: {},
  execute: (figma): ReadResult<LowcodeTranslations> => {
    const root = getRoot(figma)
    return { ok: true, data: root?.lowcodeTranslations ?? {} }
  }
})

export const readWorkflows = defineTool({
  name: 'read_workflows',
  description:
    "Read the document-level named workflows stored on the root node (`root.lowcodeWorkflows`, Phase 3 §10 v4). Shape: [{ id, name, pageId?, actions }] — reusable action chains invoked by id from any node's event handler (or another workflow) via a `callWorkflow` action; the compiler expands each chain inline at the call site. Optional pageId scopes editor/tool validation for page-local state. Use this to see which workflows exist before authoring a `callWorkflow` reference. Always returns { ok: true, data: [...] }; data is [] when no workflows are authored so AI prompts can branch on a single property. Example: read_workflows() → { ok: true, data: [{ id: 'wf-save', name: 'Save & toast', actions: [{ id: 'a1', kind: 'toast', messageExpr: '\"Saved\"', variant: 'success' }] }] } or { ok: true, data: [] }.",
  params: {},
  execute: (figma): ReadResult<WorkflowDef[]> => {
    const root = getRoot(figma)
    return { ok: true, data: root?.lowcodeWorkflows ?? [] }
  }
})
