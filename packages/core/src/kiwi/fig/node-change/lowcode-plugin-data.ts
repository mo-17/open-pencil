// Phase 1 §12: route lowcode SceneNode fields through pluginData so the .fig
// codec actually persists them. Phase 0 §2.5 promised this round-trip but
// the PR never landed — until this module, state / bindings / events /
// interactiveProps lived in editor memory only and were silently dropped on
// every save.
//
// All four values are JSON.stringify'd into PluginDataEntry.value strings
// stored under OPEN_PENCIL_PLUGIN_ID with keys in the `lowcode/<field>`
// namespace. Empty/undefined fields skip emission so .fig files that never
// touched the lowcode panel stay byte-identical (decision §12.3 #4).
//
// Step 1 (this file's serialize side) wires the save path; step 2 adds the
// read side in convert.ts.

import {
  decodeFigmaMotionSharedPayload,
  encodeFigmaMotionSharedClearEnvelope,
  encodeFigmaMotionSharedEnvelope,
  FIGMA_MOTION_SHARED_KEY,
  FIGMA_MOTION_SHARED_NAMESPACE
} from '@open-pencil/fig'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import {
  remapMotionDriverNodeReferences,
  remapMotionSceneNodeReferences,
  remapPrototypeNodeReferences,
  validateGeneratedEffectSpec,
  validateMotionDriverSpec,
  validateMotionSceneSpec,
  validateMotionSpec,
  validateMotionTransitionKey,
  validatePrototypeSpec
} from '@open-pencil/scene-graph'
import type {
  ActionDef,
  AnalyticsConfig,
  BindingExpr,
  DocumentStateDef,
  EventName,
  GeneratedEffectSpecV1,
  GridPosition,
  LowcodeHeadMetadata,
  LibraryRef,
  LowcodeTranslations,
  MotionDriverSpecV1,
  MotionSceneSpec,
  MotionSpec,
  NodeType,
  PluginDataEntry,
  PrototypeSpecV1,
  ResponsiveOverrides,
  SceneGraph,
  SceneNode,
  SeoMetadata,
  StateDef,
  StateOverrides,
  SupabaseConfig,
  WorkflowDef
} from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { compactLowcodeHeadMetadata } from '#core/lowcode-validation'

export const LOWCODE_STATE_KEY = 'lowcode/state'
export const LOWCODE_BINDINGS_KEY = 'lowcode/bindings'
export const LOWCODE_EVENTS_KEY = 'lowcode/events'
export const LOWCODE_INTERACTIVE_PROPS_KEY = 'lowcode/interactiveProps'
/** Phase 2 §9: optional per-node render-condition expression string. */
export const LOWCODE_RENDER_CONDITION_KEY = 'lowcode/renderCondition'
/** Phase 2 §2: document-level state declarations, attached to the root node only. */
export const LOWCODE_DOCUMENT_STATE_KEY = 'lowcode/documentState'
/** Phase 0 NodeType extensions that are NOT in the vendored Figma schema —
 *  kiwi serializes them as 'RECTANGLE' via `mapToFigmaType`'s default arm,
 *  so without this side-channel they all become rectangles after a save. */
export const LOWCODE_NODE_TYPE_KEY = 'lowcode/nodeType'
/** Phase 2 §6: `layoutMode: 'FREE'` is also outside the vendored Figma
 *  enum (`stackMode` carries HORIZONTAL/VERTICAL/undefined only — see
 *  `serialize.ts:285 serializeLayoutProps`). Presence of this flag (value
 *  must be boolean `true`) overrides the kiwi-restored `layoutMode` from
 *  whatever stack mode the schema gave back (typically NONE) to FREE. */
export const LOWCODE_FREE_LAYOUT_KEY = 'lowcode/freeLayout'
/** Phase 3 §2: Supabase connection settings carried on the root node only.
 *  Value is the JSON-encoded SupabaseConfig object ({ url, anonKey, schema? }).
 *  Absent ≡ no Supabase wiring → compiler skips the `_lowcode_supabase.ts`
 *  emit and `$currentUser` auto-registration. */
export const LOWCODE_SUPABASE_CONFIG_KEY = 'lowcode/supabaseConfig'
/** Phase 5 §3: static SEO metadata for compiler HTML output. Root node carries
 *  document defaults; page CANVAS nodes may carry single-page overrides. */
export const LOWCODE_SEO_METADATA_KEY = 'lowcode/seoMetadata'
/** Phase 5 §10: document-level analytics provider config. Root node only.
 *  Value is the JSON-encoded AnalyticsConfig object with public ids only. */
export const LOWCODE_ANALYTICS_CONFIG_KEY = 'lowcode/analyticsConfig'
/** Phase 5 §11: controlled custom head metadata. Root node only; structured
 *  whitelist for <meta>, <link>, and <style>, never raw script/html. */
export const LOWCODE_HEAD_METADATA_KEY = 'lowcode/headMetadata'
/** Phase 5 §11: generated-app custom CSS appended to src/index.css. */
export const LOWCODE_CUSTOM_CSS_KEY = 'lowcode/customCss'
/** Round-trip fix: `LayoutSizing` carries `'FILL'`, but the vendored Figma
 *  `StackSize` enum only has FIXED / RESIZE_TO_FIT(+implicit) — so on save
 *  `serialize.ts` collapses HUG→RESIZE_TO_FIT and **everything else (incl.
 *  FILL) → FIXED**, silently dropping FILL on every reload. Same bypass as
 *  `lowcode/freeLayout`: persist the FILL axes out-of-band. Value is a JSON
 *  object `{ primary?: 'FILL', counter?: 'FILL' }` carrying only the FILL axes;
 *  absent ≡ neither axis is FILL → legacy .fig files stay byte-identical. */
export const LOWCODE_AXIS_SIZING_KEY = 'lowcode/axisSizing'
/** Round-trip fix: `counterAxisAlignContent: 'SPACE_BETWEEN'` (wrap cross-axis
 *  distribution) has no representable field in the vendored schema
 *  (`StackCounterAlign` lacks SPACE_BETWEEN and there is no
 *  `stackCounterAlignContent`), so it was never serialized and every reload
 *  reset it to 'AUTO', shifting WRAP rows. Value is the literal string
 *  `'SPACE_BETWEEN'`; absent ≡ 'AUTO'. */
export const LOWCODE_COUNTER_ALIGN_CONTENT_KEY = 'lowcode/counterAxisAlignContent'
/** Round-trip fix: a GRID child's `gridPosition` (column/row + spans) has no
 *  per-child field in the vendored schema (only container-level grid tracks /
 *  gaps / counts exist), so explicit placements were dropped and children
 *  re-flowed into auto-placement on reopen. Value is the JSON-encoded
 *  GridPosition; absent ≡ auto-placed (`gridPosition: null`). */
export const LOWCODE_GRID_POSITION_KEY = 'lowcode/gridPosition'
/** Phase 3 §7: per-breakpoint layout overrides (responsive design). Value is
 *  the JSON-encoded `ResponsiveOverrides` map (`{ md: { layoutMode, … }, … }`).
 *  Absent ≡ single (base) layout, so .fig files that never touched the
 *  responsive panel stay byte-identical. Structured field like state/bindings
 *  — restored straight onto the SceneNode, no separate codec override. */
export const LOWCODE_RESPONSIVE_OVERRIDES_KEY = 'lowcode/responsiveOverrides'
/** Phase 4 §20: per-interaction-state appearance overrides. Value is the
 *  JSON-encoded `StateOverrides` map (`{ hover: { fills, … }, … }`). Absent ≡
 *  no state styling, so .fig files that never touched the state panel stay
 *  byte-identical. Structured field like responsiveOverrides — restored straight
 *  onto the SceneNode via `...lowcodeRest`, no separate codec override. */
export const LOWCODE_STATE_OVERRIDES_KEY = 'lowcode/stateOverrides'
/** Phase 3 §9 v7: document-level translation catalog, attached to the root node
 *  only. Value is the JSON-encoded `LowcodeTranslations` map (`{ <locale>: {
 *  <sourceMessage>: <translated> } }`). Absent ≡ no authored translations, so
 *  .fig files that never touched the i18n panel stay byte-identical. */
export const LOWCODE_TRANSLATIONS_KEY = 'lowcode/translations'
/** Phase 3 §10 v4: document-level named workflows, attached to the root node
 *  only. Value is the JSON-encoded `WorkflowDef[]` array. Absent ≡ no authored
 *  workflows, so .fig files that never defined a workflow stay byte-identical. */
export const LOWCODE_WORKFLOWS_KEY = 'lowcode/workflows'
/** Phase 3 §8 v11: per-INSTANCE override table. Descendant overrides use a
 *  stable child-index path (`<path>:<prop>` → snapshot value), since instance
 *  child ids are reassigned on load. Strict Motion owner/interaction overrides
 *  use the empty path (`:motion`, `:motionScene`, `:motionDrivers`, `:prototype`,
 *  `:transitionKey`, `:generatedEffect`); other unscoped root markers are deliberately
 *  not generalized.
 *  Restored via `reapplyInstanceOverrides` after `populateInstances`. */
export const LOWCODE_OVERRIDES_KEY = 'lowcode/overrides'

/** Phase 4 §14: cross-file/team-library metadata for cached COMPONENT masters.
 *  Value is `{ key, libraryId, version, readonly }`, mirroring the explicit
 *  SceneNode fields while keeping the cached master a normal local component. */
export const LOWCODE_LIBRARY_COMPONENT_KEY = 'lowcode/libraryComponent'

/** Phase 4 §14: root-level list of imported library sources and cached component
 *  key/version pairs. Value is a JSON-encoded `LibraryRef[]`. */
export const LOWCODE_LIBRARIES_KEY = 'lowcode/libraries'

/** Phase 4 §16.1: page-level (CANVAS) route pattern, e.g. `/product/:id`. A
 *  non-empty string on a page node; absent → slug-derived route. */
export const LOWCODE_ROUTE_PATTERN_KEY = 'lowcode/routePattern'

/** Phase 4 §16.3: page-level (CANVAS) auth-guard flag. `true` on a page node
 *  emits a redirect-if-unauthenticated guard; absent ≡ public page. */
export const LOWCODE_REQUIRES_AUTH_KEY = 'lowcode/requiresAuth'

/** Phase 4 §16.3: document-level (root) login route the auth guard redirects to
 *  (e.g. `/login`). Absent ≡ the `/login` default. */
export const LOWCODE_AUTH_REDIRECT_KEY = 'lowcode/authRedirect'

/** Declarative MotionSpec v1/v2/v3 for a single node. The value is strictly
 * validated on both import and export; malformed or future-version entries
 * stay in ordinary pluginData so a newer OpenPencil can recover them. */
export const LOWCODE_MOTION_KEY = 'lowcode/motion'
/** Bounded page/frame choreography referencing node-local Motion tracks. */
export const LOWCODE_MOTION_SCENE_KEY = 'lowcode/motionScene'
/** Bounded page/frame continuous-input mappings referencing node-local tracks. */
export const LOWCODE_MOTION_DRIVERS_KEY = 'lowcode/motionDrivers'
/** Bounded OpenPencil prototype connections, separate from native Figma interaction metadata. */
export const LOWCODE_PROTOTYPE_KEY = 'lowcode/prototype'
/** Explicit stable OpenPencil Smart Match identity. */
export const LOWCODE_TRANSITION_KEY = 'lowcode/transitionKey'
/** Strict allowlisted generated visual layer; no shader/program source is accepted. */
export const LOWCODE_GENERATED_EFFECT_KEY = 'lowcode/generatedEffect'
const PRESERVED_INVALID_MOTION_CONTRACT_KEYS: ReadonlySet<string> = new Set([
  LOWCODE_MOTION_KEY,
  LOWCODE_MOTION_SCENE_KEY,
  LOWCODE_MOTION_DRIVERS_KEY,
  LOWCODE_PROTOTYPE_KEY,
  LOWCODE_TRANSITION_KEY,
  LOWCODE_GENERATED_EFFECT_KEY
])
/** Private archival key for a conflicting active shared Motion payload. The
 *  original bytes stay recoverable without remaining executable by the Figma
 *  adapter at `openpencil/motion-v1`. */
export const LOWCODE_MOTION_SHARED_CONFLICT_KEY = 'lowcode/motionSharedConflict'

const LOWCODE_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'BUTTON',
  'INPUT',
  'CHECKBOX',
  'FORM',
  'LIST',
  'SELECT',
  // Phase 2 §8
  'RADIO',
  'TEXTAREA',
  'DATEPICKER',
  'SWITCH'
])

/** Set of pluginData keys this module owns. Step 2's read side uses it to
 *  decide which entries to absorb into structured SceneNode fields. */
export const LOWCODE_PLUGIN_KEYS: ReadonlySet<string> = new Set([
  LOWCODE_STATE_KEY,
  LOWCODE_BINDINGS_KEY,
  LOWCODE_EVENTS_KEY,
  LOWCODE_INTERACTIVE_PROPS_KEY,
  LOWCODE_RENDER_CONDITION_KEY,
  LOWCODE_DOCUMENT_STATE_KEY,
  LOWCODE_NODE_TYPE_KEY,
  LOWCODE_FREE_LAYOUT_KEY,
  LOWCODE_SUPABASE_CONFIG_KEY,
  LOWCODE_SEO_METADATA_KEY,
  LOWCODE_ANALYTICS_CONFIG_KEY,
  LOWCODE_HEAD_METADATA_KEY,
  LOWCODE_CUSTOM_CSS_KEY,
  LOWCODE_AXIS_SIZING_KEY,
  LOWCODE_COUNTER_ALIGN_CONTENT_KEY,
  LOWCODE_GRID_POSITION_KEY,
  LOWCODE_RESPONSIVE_OVERRIDES_KEY,
  LOWCODE_STATE_OVERRIDES_KEY,
  LOWCODE_TRANSLATIONS_KEY,
  LOWCODE_WORKFLOWS_KEY,
  LOWCODE_OVERRIDES_KEY,
  LOWCODE_LIBRARY_COMPONENT_KEY,
  LOWCODE_LIBRARIES_KEY,
  LOWCODE_ROUTE_PATTERN_KEY,
  LOWCODE_REQUIRES_AUTH_KEY,
  LOWCODE_AUTH_REDIRECT_KEY,
  LOWCODE_MOTION_KEY,
  LOWCODE_MOTION_SCENE_KEY,
  LOWCODE_MOTION_DRIVERS_KEY,
  LOWCODE_PROTOTYPE_KEY,
  LOWCODE_TRANSITION_KEY,
  LOWCODE_GENERATED_EFFECT_KEY
])

/**
 * Build the pluginData entries that mirror this node's lowcode fields. Order
 * is stable so two saves of the same in-memory graph produce byte-identical
 * .fig output. New keys are appended at the end so older .fig files re-saved
 * after upgrade keep their original key ordering when the new field is empty.
 *
 * Order: nodeType → state → bindings → events → interactiveProps →
 * renderCondition (Phase 2 §9) → documentState (Phase 2 §2).
 */
export function serializeLowcodeFields(node: SceneNode): PluginDataEntry[] {
  const entries: PluginDataEntry[] = []
  if (LOWCODE_NODE_TYPES.has(node.type)) {
    entries.push(makeEntry(LOWCODE_NODE_TYPE_KEY, node.type))
  }
  if (isNonEmpty(node.state)) entries.push(makeEntry(LOWCODE_STATE_KEY, node.state))
  if (isNonEmpty(node.bindings)) entries.push(makeEntry(LOWCODE_BINDINGS_KEY, node.bindings))
  if (isNonEmpty(node.events)) entries.push(makeEntry(LOWCODE_EVENTS_KEY, node.events))
  if (isNonEmpty(node.interactiveProps)) {
    entries.push(makeEntry(LOWCODE_INTERACTIVE_PROPS_KEY, node.interactiveProps))
  }
  if (typeof node.renderCondition === 'string' && node.renderCondition !== '') {
    entries.push(makeEntry(LOWCODE_RENDER_CONDITION_KEY, node.renderCondition))
  }
  if (isNonEmpty(node.lowcodeDocumentState)) {
    entries.push(makeEntry(LOWCODE_DOCUMENT_STATE_KEY, node.lowcodeDocumentState))
  }
  // Phase 2 §6: persist the FREE flag only when explicitly set; absent ≡
  // false. Legacy .fig files without the flag stay byte-identical
  // (decision §12.3 #4 + §6 risk-mitigation).
  if (node.layoutMode === 'FREE') {
    entries.push(makeEntry(LOWCODE_FREE_LAYOUT_KEY, true))
  }
  entries.push(...serializeDocumentConfigFields(node))
  // Round-trip fix: persist FILL axis sizing the vendored StackSize enum can't
  // hold. Only the FILL axes are written; if neither is FILL no entry is
  // emitted, keeping legacy .fig output byte-identical.
  const axisSizing = fillAxisSizing(node)
  if (axisSizing) entries.push(makeEntry(LOWCODE_AXIS_SIZING_KEY, axisSizing))
  // Round-trip fix: persist counterAxisAlignContent SPACE_BETWEEN (no schema
  // field). 'AUTO' (the default) writes nothing.
  if (node.counterAxisAlignContent === 'SPACE_BETWEEN') {
    entries.push(makeEntry(LOWCODE_COUNTER_ALIGN_CONTENT_KEY, 'SPACE_BETWEEN'))
  }
  // Round-trip fix: persist an explicit GRID child placement (no per-child
  // schema field). `null` (auto-placed) writes nothing.
  if (node.gridPosition) entries.push(makeEntry(LOWCODE_GRID_POSITION_KEY, node.gridPosition))
  // Phase 3 §7: per-breakpoint responsive overrides. Empty/absent map writes
  // nothing → non-responsive .fig files stay byte-identical.
  if (isNonEmpty(node.responsiveOverrides)) {
    entries.push(makeEntry(LOWCODE_RESPONSIVE_OVERRIDES_KEY, node.responsiveOverrides))
  }
  // Phase 4 §20: per-interaction-state appearance overrides. Empty/absent map
  // writes nothing → non-interactive .fig files stay byte-identical.
  if (isNonEmpty(node.stateOverrides)) {
    entries.push(makeEntry(LOWCODE_STATE_OVERRIDES_KEY, node.stateOverrides))
  }
  // Phase 3 §9 v7: document-level translation catalog (root node only). Empty/
  // absent map writes nothing → non-translated .fig files stay byte-identical.
  if (isNonEmpty(node.lowcodeTranslations)) {
    entries.push(makeEntry(LOWCODE_TRANSLATIONS_KEY, node.lowcodeTranslations))
  }
  // Phase 3 §10 v4: document-level named workflows (root node only). Empty/
  // absent array writes nothing → .fig files without workflows stay
  // byte-identical.
  if (isNonEmpty(node.lowcodeWorkflows)) {
    entries.push(makeEntry(LOWCODE_WORKFLOWS_KEY, node.lowcodeWorkflows))
  }
  entries.push(...serializeLibraryFields(node))
  // Phase 4 §16.x: routing (§16.1 route pattern) + auth-guard (§16.3 requiresAuth
  // / authRedirect) fields — grouped out to keep this function under the
  // complexity limit. Appended last so legacy .fig output stays byte-identical.
  entries.push(...serializeRoutingAuthFields(node))
  entries.push(...serializeMotionFields(node))
  entries.push(...serializeMotionSceneFields(node))
  entries.push(...serializeMotionDriverFields(node))
  entries.push(...serializePrototypeFields(node))
  entries.push(...serializeTransitionKeyField(node))
  entries.push(...serializeGeneratedEffectField(node))
  return entries
}

type ContractValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: unknown[] }

function serializeMotionContractField<T>(
  node: SceneNode,
  key: string,
  value: T | undefined,
  validate: (candidate: unknown) => ContractValidationResult<T>,
  label: string
): PluginDataEntry[] {
  if (value === undefined) return []
  const hasInertPayload = node.pluginData.some(
    (entry) => entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === key
  )
  if (hasInertPayload) {
    console.warn(
      `[lowcode] structured ${label} conflicts with inert private data; preserving the raw payload and suppressing the structured value`
    )
    return []
  }
  const validated = validate(value)
  return validated.success ? [makeEntry(key, validated.value)] : []
}

function serializeMotionSceneFields(node: SceneNode): PluginDataEntry[] {
  return serializeMotionContractField(
    node,
    LOWCODE_MOTION_SCENE_KEY,
    node.motionScene,
    validateMotionSceneSpec,
    'motion scene'
  )
}

function serializeMotionDriverFields(node: SceneNode): PluginDataEntry[] {
  return serializeMotionContractField(
    node,
    LOWCODE_MOTION_DRIVERS_KEY,
    node.motionDrivers,
    validateMotionDriverSpec,
    'motion drivers'
  )
}

function serializePrototypeFields(node: SceneNode): PluginDataEntry[] {
  return serializeMotionContractField(
    node,
    LOWCODE_PROTOTYPE_KEY,
    node.prototype,
    validatePrototypeSpec,
    'prototype'
  )
}

function serializeTransitionKeyField(node: SceneNode): PluginDataEntry[] {
  return serializeMotionContractField(
    node,
    LOWCODE_TRANSITION_KEY,
    node.transitionKey,
    validateMotionTransitionKey,
    'transition key'
  )
}

function serializeGeneratedEffectField(node: SceneNode): PluginDataEntry[] {
  return serializeMotionContractField(
    node,
    LOWCODE_GENERATED_EFFECT_KEY,
    node.generatedEffect,
    validateGeneratedEffectSpec,
    'generated effect'
  )
}

function serializeMotionFields(node: SceneNode): PluginDataEntry[] {
  const activeSharedEntries = node.pluginData.filter(isSharedMotionEntry)
  if (node.motion == null) {
    const hasActionableSharedMotion = activeSharedEntries.some((entry) => {
      const decoded = decodeFigmaMotionSharedPayload(entry.value)
      return decoded.ok && decoded.value.kind === 'motion'
    })
    return hasActionableSharedMotion
      ? [
          ...activeSharedEntries.map(archiveSharedMotionEntry),
          makeSharedMotionEntry(encodeFigmaMotionSharedClearEnvelope())
        ]
      : []
  }
  const hasInertPrivateMotion = node.pluginData.some(
    (entry) => entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === LOWCODE_MOTION_KEY
  )
  if (hasInertPrivateMotion) {
    console.warn(
      '[lowcode] structured motion conflicts with inert private motion data; preserving the raw payload and suppressing the structured value'
    )
    const hasActionableSharedMotion = activeSharedEntries.some((entry) => {
      const decoded = decodeFigmaMotionSharedPayload(entry.value)
      return decoded.ok && decoded.value.kind === 'motion'
    })
    return hasActionableSharedMotion
      ? [
          ...activeSharedEntries.map(archiveSharedMotionEntry),
          makeSharedMotionEntry(encodeFigmaMotionSharedClearEnvelope())
        ]
      : []
  }
  const validated = validateMotionSpec(node.motion)
  if (!validated.success) return []
  const sharedValue = encodeFigmaMotionSharedEnvelope(validated.value)
  const conflictingSharedEntries = activeSharedEntries.filter(
    (entry) => entry.value !== sharedValue
  )
  if (conflictingSharedEntries.length > 0) {
    console.warn(
      '[lowcode] structured motion conflicts with an active shared mirror; archiving the raw payload and replacing the active mirror with the private canonical value'
    )
  }
  return [
    makeEntry(LOWCODE_MOTION_KEY, validated.value),
    ...conflictingSharedEntries.map(archiveSharedMotionEntry),
    makeSharedMotionEntry(sharedValue)
  ]
}

function makeSharedMotionEntry(value: string): PluginDataEntry {
  return {
    pluginId: FIGMA_MOTION_SHARED_NAMESPACE,
    key: `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`,
    value
  }
}

function archiveSharedMotionEntry(entry: PluginDataEntry): PluginDataEntry {
  return {
    pluginId: OPEN_PENCIL_PLUGIN_ID,
    key: LOWCODE_MOTION_SHARED_CONFLICT_KEY,
    value: JSON.stringify({
      schema: 'openpencil.motion-shared-archive',
      version: 1,
      pluginId: entry.pluginId,
      key: entry.key,
      value: entry.value
    })
  }
}

function isSharedMotionEntry(entry: PluginDataEntry): boolean {
  return (
    entry.pluginId === FIGMA_MOTION_SHARED_NAMESPACE &&
    entry.key === `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`
  )
}

/** Phase 4 §14: team-library metadata. Empty fields write nothing so ordinary
 *  single-document components keep their previous .fig output. */
function serializeLibraryFields(node: SceneNode): PluginDataEntry[] {
  const entries: PluginDataEntry[] = []
  const libraryComponent = libraryComponentPayload(node)
  if (libraryComponent) entries.push(makeEntry(LOWCODE_LIBRARY_COMPONENT_KEY, libraryComponent))
  if (isNonEmpty(node.lowcodeLibraries)) {
    entries.push(makeEntry(LOWCODE_LIBRARIES_KEY, node.lowcodeLibraries))
  }
  return entries
}

function serializeDocumentConfigFields(node: SceneNode): PluginDataEntry[] {
  const entries: PluginDataEntry[] = []
  if (isSupabaseConfig(node.lowcodeSupabaseConfig)) {
    entries.push(makeEntry(LOWCODE_SUPABASE_CONFIG_KEY, node.lowcodeSupabaseConfig))
  }
  const seoMetadata = seoMetadataPayload(node.lowcodeSeoMetadata)
  if (seoMetadata) entries.push(makeEntry(LOWCODE_SEO_METADATA_KEY, seoMetadata))
  if (isAnalyticsConfig(node.lowcodeAnalyticsConfig)) {
    entries.push(makeEntry(LOWCODE_ANALYTICS_CONFIG_KEY, node.lowcodeAnalyticsConfig))
  }
  const headMetadata = compactLowcodeHeadMetadata(node.lowcodeHeadMetadata)
  if (headMetadata) entries.push(makeEntry(LOWCODE_HEAD_METADATA_KEY, headMetadata))
  if (typeof node.lowcodeCustomCss === 'string' && node.lowcodeCustomCss.trim() !== '') {
    entries.push(makeEntry(LOWCODE_CUSTOM_CSS_KEY, node.lowcodeCustomCss.trim()))
  }
  return entries
}

function libraryComponentPayload(node: SceneNode): JsonObject | null {
  const payload: JsonObject = {}
  if (typeof node.libraryComponentKey === 'string' && node.libraryComponentKey !== '') {
    payload.key = node.libraryComponentKey
  }
  if (typeof node.libraryId === 'string' && node.libraryId !== '')
    payload.libraryId = node.libraryId
  if (typeof node.libraryVersion === 'string' && node.libraryVersion !== '') {
    payload.version = node.libraryVersion
  }
  if (node.libraryReadonly === true) payload.readonly = true
  return Object.keys(payload).length > 0 ? payload : null
}

function seoMetadataPayload(value: SeoMetadata | undefined): SeoMetadata | null {
  if (!value) return null
  const payload: SeoMetadata = {}
  for (const key of ['title', 'description', 'image', 'canonicalUrl'] as const) {
    const fieldValue = value[key]
    if (typeof fieldValue === 'string' && fieldValue !== '') payload[key] = fieldValue
  }
  return Object.keys(payload).length > 0 ? payload : null
}

/** Phase 4 §16.x: routing + auth-guard pluginData entries (route pattern /
 *  requiresAuth / authRedirect), grouped out of `serializeLowcodeFields`. Each
 *  writes nothing when at its default → byte-identical legacy .fig output. */
function serializeRoutingAuthFields(node: SceneNode): PluginDataEntry[] {
  const entries: PluginDataEntry[] = []
  if (typeof node.lowcodeRoutePattern === 'string' && node.lowcodeRoutePattern !== '') {
    entries.push(makeEntry(LOWCODE_ROUTE_PATTERN_KEY, node.lowcodeRoutePattern))
  }
  if (node.lowcodeRequiresAuth === true) {
    entries.push(makeEntry(LOWCODE_REQUIRES_AUTH_KEY, true))
  }
  if (typeof node.lowcodeAuthRedirect === 'string' && node.lowcodeAuthRedirect !== '') {
    entries.push(makeEntry(LOWCODE_AUTH_REDIRECT_KEY, node.lowcodeAuthRedirect))
  }
  return entries
}

/**
 * Phase 3 §8 v11: serialize an INSTANCE's `overrides` table for round-trip.
 * `node.overrides` is keyed by the (unstable) instance-child id; we resolve each
 * to its master-child id (`componentId`, stable) and snapshot the child's CURRENT
 * value for that prop, so on load we can re-apply it onto the freshly cloned
 * child. Returns null for non-instances / empty overrides (legacy .fig stays
 * byte-identical). Needs the graph to resolve child ids, so it's separate from
 * `serializeLowcodeFields`. */
export function serializeInstanceOverrides(
  node: SceneNode,
  graph: SceneGraph
): PluginDataEntry | null {
  if (node.type !== 'INSTANCE') return null
  const keys = Object.keys(node.overrides)
  if (keys.length === 0) return null
  const table: Record<string, unknown> = {}
  for (const key of keys) {
    const rootOverride = canonicalRootMotionOverride(key, node.overrides[key])
    if (rootOverride.matched) {
      if (rootOverride.valid) table[`:${key}`] = rootOverride.value
      continue
    }
    const colon = key.lastIndexOf(':')
    if (colon === -1) continue
    const instChild = graph.getNode(key.slice(0, colon))
    if (!instChild) continue
    // Key by the descendant's index-path within the instance (stable across
    // save/load: node ids are remapped, but `populateInstances` re-clones the
    // master structure in the same order). value = the child's current value.
    const path = childIndexPath(graph, node.id, instChild.id)
    if (!path) continue
    const prop = key.slice(colon + 1)
    table[`${path.join('.')}:${prop}`] =
      node.overrides[key] === null ? null : instChild[prop as keyof SceneNode]
  }
  if (Object.keys(table).length === 0) return null
  return makeEntry(LOWCODE_OVERRIDES_KEY, table)
}

type RootMotionOverrideResult =
  | { matched: false }
  | { matched: true; valid: false }
  | { matched: true; valid: true; value: unknown }

const ROOT_MOTION_OVERRIDE_FIELDS = new Set([
  'motion',
  'motionScene',
  'motionDrivers',
  'prototype',
  'transitionKey',
  'generatedEffect'
])

function canonicalRootMotionOverride(key: string, value: unknown): RootMotionOverrideResult {
  if (!ROOT_MOTION_OVERRIDE_FIELDS.has(key)) return { matched: false }
  let validation: ContractValidationResult<unknown>
  if (value === null) return { matched: true, valid: true, value: null }
  switch (key) {
    case 'motion':
      validation = validateMotionSpec(value)
      break
    case 'motionScene':
      validation = validateMotionSceneSpec(value)
      break
    case 'motionDrivers':
      validation = validateMotionDriverSpec(value)
      break
    case 'prototype':
      validation = validatePrototypeSpec(value)
      break
    case 'transitionKey':
      validation = validateMotionTransitionKey(value)
      break
    case 'generatedEffect':
      validation = validateGeneratedEffectSpec(value)
      break
    default:
      return { matched: false }
  }
  return validation.success
    ? { matched: true, valid: true, value: validation.value }
    : { matched: true, valid: false }
}

function instanceComponentReferenceMap(
  graph: SceneGraph,
  instance: SceneNode
): Map<string, string> {
  const references = new Map<string, string>()
  if (instance.componentId) references.set(instance.componentId, instance.id)
  const queue = [...instance.childIds]
  for (const childId of queue) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.componentId) references.set(child.componentId, child.id)
    queue.push(...child.childIds)
  }
  return references
}

function localizeRootMotionOverride(
  field: string,
  value: unknown,
  references: ReadonlyMap<string, string>
): unknown {
  if (value === null) return value
  const resolveNodeId = (nodeId: string) => references.get(nodeId)
  if (field === 'motionScene') {
    const validated = validateMotionSceneSpec(value)
    return validated.success
      ? remapMotionSceneNodeReferences(validated.value, resolveNodeId)
      : value
  }
  if (field === 'motionDrivers') {
    const validated = validateMotionDriverSpec(value)
    return validated.success
      ? remapMotionDriverNodeReferences(validated.value, resolveNodeId)
      : value
  }
  if (field === 'prototype') {
    const validated = validatePrototypeSpec(value)
    return validated.success ? remapPrototypeNodeReferences(validated.value, resolveNodeId) : value
  }
  return value
}

/** The child-index path from `ancestorId` down to `descendantId` (e.g. [0,2] =
 *  first child's third child), or null if not a descendant. Empty array when
 *  they are the same node. */
function childIndexPath(
  graph: SceneGraph,
  ancestorId: string,
  descendantId: string
): number[] | null {
  const path: number[] = []
  let cur = graph.getNode(descendantId)
  while (cur && cur.id !== ancestorId) {
    const parent = cur.parentId ? graph.getNode(cur.parentId) : undefined
    if (!parent) return null
    const idx = parent.childIds.indexOf(cur.id)
    if (idx === -1) return null
    path.unshift(idx)
    cur = parent
  }
  return cur ? path : null
}

/**
 * Phase 3 §8 v11: re-apply instance overrides restored from `lowcode/overrides`,
 * AFTER `populateInstances` has re-cloned each instance's children from its
 * master (which resets them to master values + new ids). For every instance
 * carrying a `pendingInstanceOverrides` snapshot, map each `<path>:<prop>` entry
 * to the freshly cloned descendant, set that child's prop to the snapshot value,
 * and rebuild `node.overrides` keyed by the new child id. Reserved empty-path
 * Motion contract entries restore root-instance overrides, including explicit
 * null clears. Clears the pending field so it is idempotent. */
export function reapplyInstanceOverrides(graph: SceneGraph, nodeIds?: Iterable<string>): void {
  const nodes = nodeIds
    ? Array.from(nodeIds, (id) => graph.getNode(id)).filter(
        (node): node is SceneNode => node !== undefined
      )
    : graph.getAllNodes()
  for (const node of nodes) {
    const pending = node.pendingInstanceOverrides
    if (node.type !== 'INSTANCE' || !pending) continue
    const componentReferences = instanceComponentReferenceMap(graph, node)
    const remapped: Record<string, unknown> = {}
    for (const key of Object.keys(pending)) {
      const rootField = key.startsWith(':') ? key.slice(1) : ''
      const rootOverride = canonicalRootMotionOverride(rootField, pending[key])
      if (rootOverride.matched) {
        if (rootOverride.valid) {
          const value = localizeRootMotionOverride(
            rootField,
            rootOverride.value,
            componentReferences
          )
          if (value === null) {
            graph.clearNodeFields(node.id, [rootField as keyof SceneNode])
            remapped[rootField] = null
          } else {
            graph.updateNode(node.id, {
              [rootField]: value
            } as Partial<SceneNode>)
            remapped[rootField] = structuredClone(value)
          }
        }
        continue
      }
      const colon = key.lastIndexOf(':')
      if (colon === -1) continue
      const path = key.slice(0, colon)
      // Do not interpret arbitrary unscoped markers as root-node patches.
      // Root Motion contracts are handled narrowly above; descendants require a path.
      if (path === '') continue
      const child = resolveChildByPath(graph, node.id, path)
      if (!child) continue
      const prop = key.slice(colon + 1)
      const value = pending[key]
      const contractOverride = canonicalRootMotionOverride(prop, value)
      if (contractOverride.matched) {
        if (contractOverride.valid) {
          const localizedValue = localizeRootMotionOverride(
            prop,
            contractOverride.value,
            componentReferences
          )
          if (localizedValue === null) {
            graph.clearNodeFields(child.id, [prop as keyof SceneNode])
            remapped[`${child.id}:${prop}`] = null
          } else {
            graph.updateNode(child.id, {
              [prop]: localizedValue
            } as Partial<SceneNode>)
            remapped[`${child.id}:${prop}`] = structuredClone(localizedValue)
          }
        }
        continue
      }
      graph.updateNode(child.id, { [prop]: value } as Partial<SceneNode>)
      remapped[`${child.id}:${prop}`] = value
    }
    node.overrides = remapped
    delete node.pendingInstanceOverrides
  }
}

/** Walk a dot-separated child-index path (`"0.2"`) from `rootId` to the target
 *  descendant. Returns undefined if any index is out of range. */
function resolveChildByPath(
  graph: SceneGraph,
  rootId: string,
  path: string
): SceneNode | undefined {
  let cur = graph.getNode(rootId)
  if (path === '') return cur
  for (const part of path.split('.')) {
    if (!cur) return undefined
    const idx = Number(part)
    const childId = cur.childIds[idx]
    cur = childId ? graph.getNode(childId) : undefined
  }
  return cur
}

/** Returns the FILL axes of an auto-layout node as `{ primary?, counter? }`,
 *  or `undefined` when neither axis is FILL (so no pluginData is emitted). */
function fillAxisSizing(node: SceneNode): { primary?: 'FILL'; counter?: 'FILL' } | undefined {
  const out: { primary?: 'FILL'; counter?: 'FILL' } = {}
  if (node.primaryAxisSizing === 'FILL') out.primary = 'FILL'
  if (node.counterAxisSizing === 'FILL') out.counter = 'FILL'
  return out.primary || out.counter ? out : undefined
}

function isSupabaseConfig(value: unknown): value is SupabaseConfig {
  if (value === null || typeof value !== 'object') return false
  const v = value as JsonObject
  return (
    typeof v.url === 'string' && v.url !== '' && typeof v.anonKey === 'string' && v.anonKey !== ''
  )
}

function isSeoMetadata(value: unknown): value is SeoMetadata {
  if (!isPlainRecord(value)) return false
  return (
    optionalString(value.title) &&
    optionalString(value.description) &&
    optionalString(value.image) &&
    optionalString(value.canonicalUrl)
  )
}

function isAnalyticsConfig(value: unknown): value is AnalyticsConfig {
  if (!isPlainRecord(value)) return false
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false
  if (value.pageViews !== undefined && typeof value.pageViews !== 'boolean') return false
  if (value.respectDoNotTrack !== undefined && typeof value.respectDoNotTrack !== 'boolean')
    return false
  if (value.consentRequired !== undefined && typeof value.consentRequired !== 'boolean')
    return false
  if (value.consentRegionPreset !== undefined && value.consentRegionPreset !== 'eea') return false
  if (
    value.consentAnalyticsDefault !== undefined &&
    typeof value.consentAnalyticsDefault !== 'boolean'
  )
    return false
  if (value.consentCopy !== undefined && !isAnalyticsConsentCopy(value.consentCopy)) return false
  if (!['ga4', 'plausible', 'posthog'].includes(String(value.provider))) return false
  return (
    typeof value.id === 'string' &&
    value.id !== '' &&
    (value.endpoint === undefined || typeof value.endpoint === 'string')
  )
}

function isAnalyticsConsentCopy(value: unknown): value is AnalyticsConfig['consentCopy'] {
  if (!isPlainRecord(value)) return false
  return (
    optionalString(value.bannerText) &&
    optionalString(value.analyticsDescription) &&
    optionalString(value.privacyPolicyUrl) &&
    optionalString(value.privacyPolicyLabel)
  )
}

function isHeadMetadata(value: unknown): value is LowcodeHeadMetadata {
  if (!isPlainRecord(value)) return false
  if (value.meta !== undefined && !isHeadMetaEntries(value.meta)) return false
  if (value.link !== undefined && !isHeadLinkEntries(value.link)) return false
  if (value.styles !== undefined && !isStringArray(value.styles)) return false
  return true
}

function isHeadMetaEntries(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isPlainRecord(entry) &&
        ['name', 'property', 'httpEquiv'].includes(String(entry.kind)) &&
        typeof entry.key === 'string' &&
        entry.key.trim() !== '' &&
        typeof entry.content === 'string' &&
        entry.content.trim() !== ''
    )
  )
}

function isHeadLinkEntries(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isPlainRecord(entry) &&
        typeof entry.rel === 'string' &&
        entry.rel.trim() !== '' &&
        typeof entry.href === 'string' &&
        entry.href.trim() !== '' &&
        optionalString(entry.as) &&
        optionalString(entry.type) &&
        optionalString(entry.media) &&
        (entry.crossorigin === undefined ||
          entry.crossorigin === 'anonymous' ||
          entry.crossorigin === 'use-credentials')
    )
  )
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function makeEntry(key: string, value: unknown): PluginDataEntry {
  return { pluginId: OPEN_PENCIL_PLUGIN_ID, key, value: JSON.stringify(value) }
}

function isNonEmpty(value: unknown): boolean {
  if (value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (value !== null && typeof value === 'object') return Object.keys(value).length > 0
  return true
}

/**
 * Read side of the §12 round-trip. Walks `nc.pluginData`, splitting entries
 * into two buckets:
 *
 *   - Entries we own (`pluginID === OPEN_PENCIL_PLUGIN_ID` AND `key` is one of
 *     the known LOWCODE_PLUGIN_KEYS): JSON.parse'd into the structured
 *     SceneNode field they correspond to. The raw entry is **removed** from
 *     the returned pluginData so the in-memory SceneNode keeps a single
 *     source of truth for these fields.
 *   - Everything else (other plugins, unknown future `lowcode/…` keys, our
 *     own non-lowcode keys like `textDirection`): passes through unchanged,
 *     after the codec `pluginID` → entry `pluginId` casing flip.
 *
 * JSON.parse failures: the offending entry is dropped from both buckets and
 * a `console.warn` is logged so the failure isn't silent. The other lowcode
 * entries on the same node continue to parse normally.
 */
export interface ExtractedLowcodeAndPluginData {
  pluginData: PluginDataEntry[]
  /** Strictly validated MotionSpec v1/v2/v3. Invalid or unsupported future versions
   *  are intentionally left in pluginData instead of being executed. */
  motion?: MotionSpec
  /** Strictly validated page/frame choreography. Invalid/future data stays inert. */
  motionScene?: MotionSceneSpec
  /** Strictly validated page/frame continuous-input mappings. */
  motionDrivers?: MotionDriverSpecV1
  /** Strictly validated OpenPencil prototype connections. */
  prototype?: PrototypeSpecV1
  /** Explicit stable Smart Match identity. */
  transitionKey?: string
  /** Strictly validated generated visual layer. Invalid/future data stays inert. */
  generatedEffect?: GeneratedEffectSpecV1
  /** Override for `mapNodeType`'s 'RECTANGLE' fallback. Present only when
   *  the SceneNode was one of the lowcode interactive types on save. */
  nodeTypeOverride?: NodeType
  state?: StateDef[]
  bindings?: Record<string, BindingExpr>
  events?: Partial<Record<EventName, ActionDef[]>>
  interactiveProps?: Record<string, unknown>
  renderCondition?: string
  /** Phase 2 §2: document-level state declarations (only the root node
   *  carries this in practice; on other nodes it stays undefined). */
  lowcodeDocumentState?: DocumentStateDef[]
  /** Phase 2 §6: when present, callers must override the kiwi-restored
   *  `layoutMode` to `'FREE'`. The vendored schema can only carry
   *  HORIZONTAL/VERTICAL/undefined in `stackMode`, so we store FREE
   *  out-of-band via the `lowcode/freeLayout` flag and restore here. */
  freeLayoutOverride?: true
  /** Phase 3 §2: Supabase connection config restored from
   *  `lowcode/supabaseConfig`. Present only when the saved value passed
   *  the type guard (object with non-empty `url` and `anonKey`). */
  lowcodeSupabaseConfig?: SupabaseConfig
  /** Phase 5 §3: static SEO metadata restored from `lowcode/seoMetadata`. Root
   *  node values are document defaults; page CANVAS values are single-page
   *  overrides. */
  lowcodeSeoMetadata?: SeoMetadata
  /** Phase 5 §10: analytics provider config restored from
   *  `lowcode/analyticsConfig`. */
  lowcodeAnalyticsConfig?: AnalyticsConfig
  /** Phase 5 §11: controlled custom head metadata restored from
   *  `lowcode/headMetadata`. */
  lowcodeHeadMetadata?: LowcodeHeadMetadata
  /** Phase 5 §11: custom CSS restored from `lowcode/customCss`. */
  lowcodeCustomCss?: string
  /** Round-trip fix: FILL axes restored from `lowcode/axisSizing`. Callers
   *  override the kiwi-restored (FIXED) sizing for whichever axis is present. */
  primaryAxisSizingOverride?: 'FILL'
  counterAxisSizingOverride?: 'FILL'
  /** Round-trip fix: present (always `'SPACE_BETWEEN'`) when the saved node had
   *  that wrap distribution; callers override the kiwi-restored 'AUTO'. */
  counterAxisAlignContentOverride?: 'SPACE_BETWEEN'
  /** Round-trip fix: explicit GRID child placement restored from
   *  `lowcode/gridPosition`. Present only when the saved value had the four
   *  numeric placement fields. */
  gridPositionOverride?: GridPosition
  /** Phase 3 §7: per-breakpoint responsive overrides. Structured field — flows
   *  straight onto the SceneNode via `...lowcodeRest` (no codec override). */
  responsiveOverrides?: ResponsiveOverrides
  /** Phase 4 §20: per-interaction-state appearance overrides. Structured field
   *  — flows straight onto the SceneNode via `...lowcodeRest` (no codec override). */
  stateOverrides?: StateOverrides
  /** Phase 3 §9 v7: document-level translation catalog (root node only).
   *  Restored onto the root via `assignImportedLowcodeFields`; on regular nodes
   *  it flows through `...lowcodeRest` (harmless — root-only in practice). */
  lowcodeTranslations?: LowcodeTranslations
  /** Phase 3 §10 v4: document-level named workflows (root node only). Restored
   *  onto the root via `assignImportedLowcodeFields`; on regular nodes it flows
   *  through `...lowcodeRest` (harmless — root-only in practice). */
  lowcodeWorkflows?: WorkflowDef[]
  /** Phase 4 §16.1: page-level route pattern (page node only). Restored onto the
   *  page via `assignImportedLowcodeFields`; on regular nodes it flows through
   *  `...lowcodeRest` (harmless — page-only in practice). */
  lowcodeRoutePattern?: string
  /** Phase 4 §16.3: page-level auth-guard flag (page node only). Restored onto the
   *  page via `assignImportedLowcodeFields`. */
  lowcodeRequiresAuth?: boolean
  /** Phase 4 §16.3: document-level login redirect (root node only). Restored onto
   *  the root via `assignImportedLowcodeFields`. */
  lowcodeAuthRedirect?: string
  /** Phase 4 §14: cached local COMPONENT master metadata restored from
   *  `lowcode/libraryComponent`. */
  libraryComponentKey?: string
  libraryId?: string
  libraryVersion?: string
  libraryReadonly?: boolean
  /** Phase 4 §14: root-level imported library refs restored from
   *  `lowcode/libraries`. */
  lowcodeLibraries?: LibraryRef[]
  /** Phase 3 §8 v11: per-instance override snapshot (keyed by master-child id).
   *  Flows onto the node via `...lowcodeRest` as `pendingInstanceOverrides`, then
   *  `reapplyInstanceOverrides` remaps it after populate. */
  pendingInstanceOverrides?: Record<string, unknown>
}

export function extractLowcodeAndPluginData(
  nc: Pick<NodeChange, 'pluginData'>
): ExtractedLowcodeAndPluginData {
  const pluginData: PluginDataEntry[] = []
  const result: ExtractedLowcodeAndPluginData = { pluginData }
  const sharedMotionCandidates: Array<{ entry: PluginDataEntry; motion: MotionSpec }> = []
  let inertPrivateMotion = false
  let sharedMotionCleared = false
  for (const entry of nc.pluginData ?? []) {
    const preservedEntry = { pluginId: entry.pluginID, key: entry.key, value: entry.value }
    if (isSharedMotionNodeChangeEntry(entry)) {
      const decoded = decodeFigmaMotionSharedPayload(entry.value)
      if (decoded.ok) {
        if (decoded.value.kind === 'motion') {
          sharedMotionCandidates.push({
            entry: preservedEntry,
            motion: decoded.value.value.motion
          })
        } else {
          sharedMotionCleared = true
        }
      } else {
        pluginData.push(preservedEntry)
      }
      continue
    }
    const isOurs = entry.pluginID === OPEN_PENCIL_PLUGIN_ID && LOWCODE_PLUGIN_KEYS.has(entry.key)
    if (!isOurs) {
      pluginData.push(preservedEntry)
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(entry.value)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (PRESERVED_INVALID_MOTION_CONTRACT_KEYS.has(entry.key)) {
        if (entry.key === LOWCODE_MOTION_KEY) inertPrivateMotion = true
        console.warn(
          `[lowcode] failed to parse pluginData "${entry.key}": ${reason}; preserving inert entry`
        )
        pluginData.push(preservedEntry)
        continue
      }
      console.warn(`[lowcode] failed to parse pluginData "${entry.key}": ${reason}; dropping entry`)
      continue
    }
    const contractAssignment = assignParsedMotionContract(result, entry.key, parsed, preservedEntry)
    if (contractAssignment.handled) {
      inertPrivateMotion ||= contractAssignment.inertPrivateMotion === true
      continue
    }
    assignLowcodeField(result, entry.key, parsed)
  }
  resolveSharedMotionCandidates(
    result,
    sharedMotionCandidates,
    inertPrivateMotion,
    sharedMotionCleared
  )
  return result
}

function isSharedMotionNodeChangeEntry(
  entry: NonNullable<NodeChange['pluginData']>[number]
): boolean {
  return (
    entry.pluginID === FIGMA_MOTION_SHARED_NAMESPACE &&
    entry.key === `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`
  )
}

interface MotionContractAssignment {
  handled: boolean
  inertPrivateMotion?: boolean
}

function assignParsedMotionContract(
  result: ExtractedLowcodeAndPluginData,
  key: string,
  parsed: unknown,
  preservedEntry: PluginDataEntry
): MotionContractAssignment {
  if (key === LOWCODE_MOTION_KEY) {
    const validated = validateMotionSpec(parsed)
    if (validated.success) result.motion = validated.value
    else result.pluginData.push(preservedEntry)
    return { handled: true, inertPrivateMotion: !validated.success }
  }
  if (key === LOWCODE_MOTION_SCENE_KEY) {
    const validated = validateMotionSceneSpec(parsed)
    if (validated.success) result.motionScene = validated.value
    else result.pluginData.push(preservedEntry)
    return { handled: true }
  }
  if (key === LOWCODE_MOTION_DRIVERS_KEY) {
    const validated = validateMotionDriverSpec(parsed)
    if (validated.success) result.motionDrivers = validated.value
    else result.pluginData.push(preservedEntry)
    return { handled: true }
  }
  if (key === LOWCODE_PROTOTYPE_KEY) {
    const validated = validatePrototypeSpec(parsed)
    if (validated.success) result.prototype = validated.value
    else result.pluginData.push(preservedEntry)
    return { handled: true }
  }
  if (key === LOWCODE_TRANSITION_KEY) {
    const validated = validateMotionTransitionKey(parsed)
    if (validated.success) result.transitionKey = validated.value
    else result.pluginData.push(preservedEntry)
    return { handled: true }
  }
  if (key === LOWCODE_GENERATED_EFFECT_KEY) {
    const validated = validateGeneratedEffectSpec(parsed)
    if (validated.success) result.generatedEffect = validated.value
    else result.pluginData.push(preservedEntry)
    return { handled: true }
  }
  return { handled: false }
}

function resolveSharedMotionCandidates(
  result: ExtractedLowcodeAndPluginData,
  candidates: Array<{ entry: PluginDataEntry; motion: MotionSpec }>,
  inertPrivateMotion: boolean,
  sharedMotionCleared: boolean
): void {
  if (candidates.length === 0) return
  const signatures = new Set(candidates.map(({ motion }) => JSON.stringify(motion)))
  const privateSignature = result.motion ? JSON.stringify(result.motion) : undefined
  const sharedSignature = JSON.stringify(candidates[0].motion)
  if (
    !inertPrivateMotion &&
    !sharedMotionCleared &&
    signatures.size === 1 &&
    privateSignature === undefined
  ) {
    result.motion = candidates[0].motion
    return
  }
  if (!inertPrivateMotion && signatures.size === 1 && privateSignature === sharedSignature) return
  result.pluginData.push(...candidates.map(({ entry }) => archiveSharedMotionEntry(entry)))
  console.warn(
    '[lowcode] shared Figma Motion data conflicts with the private canonical value; archiving it as inert private plugin data'
  )
}

/** Convert lowcode plugin data into fields safe to spread onto a SceneNode. */
export function extractImportedLowcodeProps(nc: Pick<NodeChange, 'pluginData'>): {
  nodeTypeOverride?: SceneNode['type']
  props: Partial<SceneNode>
} {
  const {
    nodeTypeOverride,
    freeLayoutOverride,
    primaryAxisSizingOverride,
    counterAxisSizingOverride,
    counterAxisAlignContentOverride,
    gridPositionOverride,
    ...props
  } = extractLowcodeAndPluginData(nc)
  return {
    nodeTypeOverride,
    props: {
      ...props,
      ...(freeLayoutOverride ? { layoutMode: 'FREE' as const } : {}),
      ...(primaryAxisSizingOverride ? { primaryAxisSizing: primaryAxisSizingOverride } : {}),
      ...(counterAxisSizingOverride ? { counterAxisSizing: counterAxisSizingOverride } : {}),
      ...(counterAxisAlignContentOverride
        ? { counterAxisAlignContent: counterAxisAlignContentOverride }
        : {}),
      ...(gridPositionOverride ? { gridPosition: gridPositionOverride } : {})
    }
  }
}

function assignLowcodeField(
  target: ExtractedLowcodeAndPluginData,
  key: string,
  value: unknown
): void {
  switch (key) {
    case LOWCODE_NODE_TYPE_KEY:
      if (typeof value === 'string' && LOWCODE_NODE_TYPES.has(value as NodeType)) {
        target.nodeTypeOverride = value as NodeType
      }
      return
    case LOWCODE_STATE_KEY:
      target.state = value as StateDef[]
      return
    case LOWCODE_BINDINGS_KEY:
      target.bindings = value as Record<string, BindingExpr>
      return
    case LOWCODE_EVENTS_KEY:
      target.events = value as Partial<Record<EventName, ActionDef[]>>
      return
    case LOWCODE_INTERACTIVE_PROPS_KEY:
      target.interactiveProps = value as JsonObject
      return
    case LOWCODE_RENDER_CONDITION_KEY:
      if (typeof value === 'string') target.renderCondition = value
      return
    case LOWCODE_DOCUMENT_STATE_KEY:
      target.lowcodeDocumentState = value as DocumentStateDef[]
      return
    case LOWCODE_FREE_LAYOUT_KEY:
      // Strict boolean-true gate — anything else is treated as absent so a
      // hand-edited / malformed .fig doesn't accidentally toggle FREE.
      if (value === true) target.freeLayoutOverride = true
      return
    case LOWCODE_SUPABASE_CONFIG_KEY:
      // Strict type-guard same as the write side: object with non-empty
      // `url` and `anonKey`. Anything else (corrupt JSON, schema mismatch)
      // is treated as absent rather than dropped silently — the read-side
      // JSON.parse already logged a warn for true parse failures.
      if (isSupabaseConfig(value)) target.lowcodeSupabaseConfig = value
      return
    default:
      assignLowcodeContentOrLayoutField(target, key, value)
  }
}

function assignLowcodeContentOrLayoutField(
  target: ExtractedLowcodeAndPluginData,
  key: string,
  value: unknown
): void {
  if (assignLowcodeContentField(target, key, value)) return
  // Less common lowcode pluginData families are grouped out to keep this
  // switch under the complexity limit.
  assignLowcodeLayoutFix(target, key, value)
}

function assignLowcodeContentField(
  target: ExtractedLowcodeAndPluginData,
  key: string,
  value: unknown
): boolean {
  if (key === LOWCODE_SEO_METADATA_KEY) {
    if (isSeoMetadata(value)) target.lowcodeSeoMetadata = value
    return true
  }
  if (key === LOWCODE_ANALYTICS_CONFIG_KEY) {
    if (isAnalyticsConfig(value)) target.lowcodeAnalyticsConfig = value
    return true
  }
  if (key === LOWCODE_HEAD_METADATA_KEY) {
    if (isHeadMetadata(value)) target.lowcodeHeadMetadata = value
    return true
  }
  if (key === LOWCODE_CUSTOM_CSS_KEY) {
    if (typeof value === 'string' && value.trim() !== '') target.lowcodeCustomCss = value
    return true
  }
  if (key === LOWCODE_TRANSLATIONS_KEY) {
    // Light guard: a non-null, non-array object. Per-locale / per-message
    // shape isn't strictly validated here — the compiler emit only reads
    // string values via `?? source` fallback, so a stray non-string is
    // harmless. The write path (`set_translations`) validates strictly.
    if (isLowcodeTranslations(value)) target.lowcodeTranslations = value
    return true
  }
  if (key === LOWCODE_WORKFLOWS_KEY) {
    // Light guard: an array of plain objects. Per-action shape isn't strictly
    // validated here — the IR collect pass drops malformed actions with a
    // warning. The write path (`set_workflows`) validates strictly.
    if (isLowcodeWorkflows(value)) target.lowcodeWorkflows = value
    return true
  }
  return false
}

function assignLowcodeLibraryField(
  target: ExtractedLowcodeAndPluginData,
  key: string,
  value: unknown
): void {
  switch (key) {
    case LOWCODE_LIBRARY_COMPONENT_KEY:
      if (isLibraryComponentPayload(value)) {
        if (typeof value.key === 'string') target.libraryComponentKey = value.key
        if (typeof value.libraryId === 'string') target.libraryId = value.libraryId
        if (typeof value.version === 'string') target.libraryVersion = value.version
        if (value.readonly === true) target.libraryReadonly = true
      }
      return
    case LOWCODE_LIBRARIES_KEY:
      if (isLibraryRefs(value)) target.lowcodeLibraries = value
  }
}

function assignLowcodeLayoutFix(
  target: ExtractedLowcodeAndPluginData,
  key: string,
  value: unknown
): void {
  switch (key) {
    case LOWCODE_AXIS_SIZING_KEY:
      assignFillAxisSizing(target, value)
      return
    case LOWCODE_COUNTER_ALIGN_CONTENT_KEY:
      if (value === 'SPACE_BETWEEN') target.counterAxisAlignContentOverride = 'SPACE_BETWEEN'
      return
    case LOWCODE_RESPONSIVE_OVERRIDES_KEY:
      if (isResponsiveOverrides(value)) target.responsiveOverrides = value
      return
    case LOWCODE_STATE_OVERRIDES_KEY:
      if (isStateOverrides(value)) target.stateOverrides = value
      return
    case LOWCODE_GRID_POSITION_KEY:
      if (isGridPosition(value)) target.gridPositionOverride = value
      return
    case LOWCODE_OVERRIDES_KEY:
      // Phase 3 §8 v11: per-instance override snapshot (`<path>:<prop>` → value).
      // Light guard (non-null, non-array object); remapped onto cloned children by
      // `reapplyInstanceOverrides` after populate, where unknown paths just no-op.
      if (isPlainRecord(value)) target.pendingInstanceOverrides = value
      return
    case LOWCODE_LIBRARY_COMPONENT_KEY:
    case LOWCODE_LIBRARIES_KEY:
      assignLowcodeLibraryField(target, key, value)
      return
    case LOWCODE_ROUTE_PATTERN_KEY:
      // Phase 4 §16.1: page-level route pattern. Light guard (string). Pattern
      // well-formedness (leading `/`) is checked by the compiler's collectTree,
      // which warns + falls back to the slug route for malformed values — so a
      // stray non-`/` string is harmless here.
      if (typeof value === 'string') target.lowcodeRoutePattern = value
      return
    case LOWCODE_REQUIRES_AUTH_KEY:
      // Phase 4 §16.3: page-level auth-guard flag. Strict boolean-true gate (same
      // posture as FREE) so a hand-edited / malformed .fig never accidentally
      // guards a page.
      if (value === true) target.lowcodeRequiresAuth = true
      return
    case LOWCODE_AUTH_REDIRECT_KEY:
      // Phase 4 §16.3: document-level login redirect. Light guard (string); the
      // compiler defaults to `/login` when absent.
      if (typeof value === 'string') target.lowcodeAuthRedirect = value
  }
}

/** Light guard: a non-null, non-array object. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Light guard: a non-null, non-array object. The emit side only iterates the
 *  known breakpoint keys (`sm`/`md`/`lg`/`xl`), so any stray keys are ignored
 *  harmlessly; we just reject scalars/arrays from a corrupt .fig. */
function isResponsiveOverrides(value: unknown): value is ResponsiveOverrides {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Light guard (non-null, non-array object), mirroring {@link isResponsiveOverrides}.
 *  The emit side reads each per-state override defensively (re-derives a CSS
 *  diff), so a loose shape is safe; a malformed value from a corrupt .fig is
 *  rejected only at the object level. */
function isStateOverrides(value: unknown): value is StateOverrides {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Light guard: a non-null, non-array object (locale → message map). The emit
 *  side reads string values defensively (`?? source`), so loose shape is safe;
 *  strict per-message validation lives on the write path (`set_translations`). */
function isLowcodeTranslations(value: unknown): value is LowcodeTranslations {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Light guard: an array of plain objects (`WorkflowDef[]`). Per-workflow /
 *  per-action shape isn't validated here — the IR collect pass drops malformed
 *  actions with a warning, and the write path (`set_workflows`) validates
 *  strictly. We only reject non-arrays from a corrupt .fig. */
function isLowcodeWorkflows(value: unknown): value is WorkflowDef[] {
  return Array.isArray(value) && value.every((w) => w !== null && typeof w === 'object')
}

interface LibraryComponentPayload {
  key?: string
  libraryId?: string
  version?: string
  readonly?: boolean
}

function isLibraryComponentPayload(value: unknown): value is LibraryComponentPayload {
  if (!isPlainRecord(value)) return false
  return (
    optionalString(value.key) &&
    optionalString(value.libraryId) &&
    optionalString(value.version) &&
    optionalBoolean(value.readonly)
  )
}

function isLibraryRefs(value: unknown): value is LibraryRef[] {
  return Array.isArray(value) && value.every(isLibraryRef)
}

function isLibraryRef(value: unknown): value is LibraryRef {
  if (!isPlainRecord(value)) return false
  return (
    typeof value.libraryId === 'string' &&
    typeof value.name === 'string' &&
    isLibrarySource(value.source) &&
    Array.isArray(value.importedComponents) &&
    value.importedComponents.every(isLibraryImportedComponent)
  )
}

function isLibrarySource(value: unknown): value is LibraryRef['source'] {
  if (!isPlainRecord(value)) return false
  return (value.kind === 'file' || value.kind === 'url') && typeof value.ref === 'string'
}

function isLibraryImportedComponent(
  value: unknown
): value is LibraryRef['importedComponents'][number] {
  return isPlainRecord(value) && typeof value.key === 'string' && typeof value.version === 'string'
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

/** Strict guard: all four placement fields must be finite numbers, else the
 *  malformed value is treated as absent (child stays auto-placed). */
function isGridPosition(value: unknown): value is GridPosition {
  if (value === null || typeof value !== 'object') return false
  const v = value as JsonObject
  return (
    typeof v.column === 'number' &&
    typeof v.row === 'number' &&
    typeof v.columnSpan === 'number' &&
    typeof v.rowSpan === 'number'
  )
}

/** Read side of {@link fillAxisSizing}. Strict guard: only the literal 'FILL'
 *  per axis is honored — a malformed value leaves the kiwi-restored (FIXED)
 *  sizing untouched. */
function assignFillAxisSizing(target: ExtractedLowcodeAndPluginData, value: unknown): void {
  if (value === null || typeof value !== 'object') return
  const v = value as JsonObject
  if (v.primary === 'FILL') target.primaryAxisSizingOverride = 'FILL'
  if (v.counter === 'FILL') target.counterAxisSizingOverride = 'FILL'
}
