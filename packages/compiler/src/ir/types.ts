/**
 * Framework-neutral IR. Modules under `ir/` MUST NOT import from
 * `adapters/**`; the data flow is one-way (SceneGraph → IR → adapter).
 */

import type { ExprAst } from '@open-pencil/core/lowcode-validation'

export type IRNode = IRElement | IRText | IRExpression | IRConditional | IRList | IRComponentRef

/**
 * Phase 3 §8 — a reference to a reusable component (a Figma COMPONENT master,
 * emitted once as `src/components/<name>.tsx`). Replaces inlining the subtree
 * for the master node itself and every *clean* INSTANCE (one with no overrides);
 * instances that carry overrides fall back to inline emission to stay faithful.
 * `className` carries the ref site's own classes (size/fill/position), which the
 * component applies to its root — so each usage is positioned in its own
 * context while sharing the children subtree.
 */
export interface IRComponentRef {
  kind: 'componentRef'
  /** SceneNode id of the master/instance this ref was derived from. */
  sourceId: string
  /** PascalCase component name (matches the emitted `src/components/<name>.tsx`). */
  name: string
  /** Space-separated Tailwind classes for this usage's root (empty when none). */
  className: string
  /** Phase 3 §8 v2 — text-override prop values this usage passes
   *  (`<Name title="new" />`). Empty for the master and clean instances (they
   *  fall back to the component's per-prop defaults). */
  props: ComponentRefProp[]
}

/** Phase 3 §8 v2/v3/v4 — which override a component prop carries. `text` feeds a
 *  TEXT node's content (`{prop}`); `className` (Phase 3 §8 v3) replaces a
 *  child's whole className (`className={prop}`); `variant` (Phase 3 §8 v4)
 *  selects a COMPONENT_SET variant subtree. Only `className` values are
 *  Tailwind-safelisted. */
export type ComponentPropKind = 'text' | 'className' | 'variant'

/** Phase 3 §8 v2 — one override value passed at a component usage site. */
export interface ComponentRefProp {
  /** Prop name on the component (matches a `ComponentDef.props[].name`). */
  name: string
  /** The overridden value (text content, or a Tailwind class string). */
  value: string
  /** Phase 3 §8 v3 — text content vs className (drives safelisting). */
  kind: ComponentPropKind
}

/** Phase 3 §8 v2/v3 — a prop slot on a reusable component. Derived from a
 *  `:text` (content) or `:fills` (className) override that at least one
 *  instance carries; the master child's own value is the default so clean
 *  usages render unchanged. */
export interface ComponentProp {
  /** Prop name (camel-ish, derived from the master child's layer name). */
  name: string
  /** Default value = the master child's text (text) or className (className). */
  defaultValue: string
  /** Phase 3 §8 v3 — text content vs className. */
  kind: ComponentPropKind
}

/**
 * Phase 3 §8 — a reusable component definition extracted from a COMPONENT
 * master. `children` is the master's subtree IR; the adapter wraps it in a
 * `<div className={className}>` whose class string is supplied per usage.
 */
export interface ComponentDef {
  /** Master COMPONENT node id (the registry key). */
  componentId: string
  /** PascalCase React component name. */
  name: string
  /** The master's child subtrees (the shared body). Empty for a COMPONENT_SET
   *  (Phase 3 §8 v4) — its subtrees live per-variant in `variants`. */
  children: IRNode[]
  /** Phase 3 §8 v2 — text prop slots (union of `:text` overrides across all
   *  instances). The adapter emits one optional prop per entry, defaulting to
   *  the master child's text. Empty when no instance overrides text. */
  props: ComponentProp[]
  /** Phase 3 §8 v4 — when set, this component is a COMPONENT_SET: it takes one
   *  string-union prop per variant axis and switches between `variants`
   *  subtrees. `children` / `props` are then empty. */
  variantAxes?: VariantAxis[]
  /** Phase 3 §8 v4 — one entry per variant (a COMPONENT child of the SET). */
  variants?: VariantCase[]
  /** Binary assets referenced by this component body. */
  assets?: IRAsset[]
}

/** Phase 3 §8 v4 — one variant axis of a COMPONENT_SET (e.g. `Size`). */
export interface VariantAxis {
  /** Sanitized prop name (camel-ish, e.g. `size`). */
  name: string
  /** Raw Figma axis name as it appears in variant child names (e.g. `Size`). */
  rawName: string
  /** All values this axis takes across the SET's variants (first-seen order). */
  options: string[]
  /** Default value (the first variant's value for this axis). */
  defaultValue: string
}

/** Phase 3 §8 v4 — a single variant's subtree, keyed by its axis values joined
 *  with `|` in `variantAxes` order (e.g. `Large|Default`). */
export interface VariantCase {
  key: string
  children: IRNode[]
}

export interface IRElement {
  kind: 'element'
  /** SceneNode id this IR node was derived from. Adapters may emit this as a
   *  `data-node-id` attribute later for canvas↔preview highlighting. */
  sourceId: string
  /** Lowercase HTML tag for the adapter to emit (e.g. 'div', 'input'). */
  tag: string
  /** Space-separated Tailwind class string. Empty string when no classes.
   *  Stays populated even when `classNameProp` is set — it is the prop's
   *  default and the value Tailwind safelisting walks. */
  className: string
  /** Phase 3 §8 v3 — when set, this element is a component-body child whose
   *  className comes from a prop (`className={<classNameProp>}`) so a fill
   *  override on an instance can re-style it. The static `className` above is
   *  the default. Only set inside a component body. */
  classNameProp?: string
  /** Phase 3 §8 v5 — inside a COMPONENT_SET variant subtree, a single
   *  className prop spans multiple variant subtrees with different static
   *  defaults, so the adapter emits `className={<classNameProp> ?? "<className>"}`
   *  (the static `className` is this variant's own fallback). Set only
   *  alongside `classNameProp` in a variant body. */
  classNamePropFallback?: true
  /** Static JSX attributes. Adapters quote/escape per their syntax. */
  attrs: Record<string, IRAttrValue>
  children: IRNode[]
  /** Event handlers. Phase 0 only emits `onClick` (BUTTON) and `onSubmit` (FORM). */
  events?: Partial<Record<IREventName, IREventHandler[]>>
  /** Phase 3 §3.x: controlled-input two-way wiring for INPUT nodes that bind
   *  `bindings.value` to a string-typed docState or page-state. Adapter emits
   *  `value={<read>}` plus a synthesized `onChange` writer; uncontrolled
   *  `defaultValue` and any user-defined `onChange` are dropped (the latter
   *  is composed after the synthesized writer in the same handler (§28). */
  controlled?: IRControlledInput
  /** Phase 4 §18 — file-upload wiring for an INPUT carrying
   *  `interactiveProps.upload`. The adapter emits `<input type="file">` + an
   *  onChange that uploads to Supabase Storage and writes the public URL into a
   *  doc-state. Mutually exclusive with `controlled` (a file input is
   *  uncontrolled); collect skips controlled wiring when this is set. */
  upload?: IRUpload
  /** Phase 3 §15 Phase B — semantic hint identifying an interactive form
   *  control whose plain-HTML emit a UI-kit adapter may replace with a
   *  composed component (shadcn `<Select>`, `<Checkbox>`, `<Switch>`,
   *  `<RadioGroup>`). Set on the control's root element by collect; the plain
   *  React adapter ignores it (→ byte-identical output), the kit's
   *  `emitControl` hook consumes it. `radio-group` / `checkbox-group` mark the
   *  wrapper `<div>` whose `<input type=radio>` / `<input type=checkbox>` leaves
   *  carry the `controlled` descriptor. Phase 4 §15 Phase C: the array
   *  multi-select checkbox-group is `checkbox-group` (shadcn has no native group
   *  component, so the adapter emits N `<Checkbox>` rows + manual array toggle).
   *  Dynamic (data-bound) option lists are deferred to §17. */
  controlKind?: 'select' | 'checkbox' | 'switch' | 'radio-group' | 'checkbox-group'
  /** Phase 4 §15.1 — semantic hint identifying a card-like container FRAME whose
   *  plain `<div>` emit a UI-kit adapter may replace with a `<Card>` wrapper.
   *  Set on the element by collect via a heuristic (FRAME + visible background
   *  fill + rounded corners). Unlike `controlKind`, a card WRAPS its children
   *  (they emit normally inside `<Card>`); the plain React adapter ignores this
   *  hint (→ byte-identical output). */
  containerKind?: 'card'
  /** Phase 4 §22 — semantic hint for shadcn display primitives. Set from
   *  `interactiveProps.uiKit.primitive`; plain emit ignores it, while a UI-kit
   *  adapter may map it to Badge/Alert/Separator/Skeleton/Progress/Avatar and
   *  the v2 composed Tabs/Accordion primitives. */
  displayKind?:
    | 'badge'
    | 'alert'
    | 'separator'
    | 'skeleton'
    | 'progress'
    | 'avatar'
    | 'tabs'
    | 'accordion'
  /** Phase 4 §22 — optional primitive-specific props for displayKind. */
  display?: IRDisplayPrimitive
  /** Phase 4 §21 — overlay container metadata lifted from
   *  `interactiveProps.overlay`. The element itself is the overlay panel; the
   *  React adapter wraps it in a fixed-position conditional shell with an
   *  optional backdrop close handler. */
  overlay?: IROverlay
  /** Phase 4 §25 — external link metadata lifted from `interactiveProps.link`
   *  or direct `interactiveProps.href/target`. The adapter emits this element
   *  as an `<a>` with href/target/rel, separate from internal navigate actions. */
  link?: IRLink
  /** Phase 4 §23 — named lucide-react icon lifted from
   *  `interactiveProps.icon`. The React adapter emits the named lucide
   *  component and imports it from `lucide-react`; existing vector SVG icon
   *  folding remains the fallback for path-based icon artwork. */
  icon?: IRLucideIcon
  /** Phase 4 §19 — client-side validation for a controlled form field carrying
   *  `interactiveProps.validation`. The adapter emits `aria-invalid` + an
   *  `onBlur` that validates the field, and wraps the input with a per-field
   *  error `<p>`. Set only on a controlled field (the value is read fresh from
   *  the field's doc-state at validate time); a validation config on an
   *  uncontrolled input is skipped with a warning. */
  validation?: IRFieldValidation
  /** Phase 4 §19 — set on a `<form>` element with ≥1 validated descendant
   *  field. The adapter wraps the form's `onSubmit` so it `preventDefault()`s,
   *  validates every listed field key, and aborts (skipping the user's submit
   *  actions) when any field is invalid. The keys are the descendant fields'
   *  SceneNode ids. */
  formValidationKeys?: string[]
  /** Phase 4 §24.1 — set when a node carries `interactiveProps.image`. The node
   *  emits a void `<img>` (its `tag` is already `'img'`) with this src + alt;
   *  the `object-fit` / `aspect-[…]` utilities ride `className`. The `src` is a
   *  literal URL (`srcLiteral`) or an expression (`srcExpr`, e.g. a doc-state
   *  binding to a §18 upload result). */
  image?: IRImage
  /** Raw inner HTML to emit verbatim via `dangerouslySetInnerHTML` instead of
   *  `children`. Set for vector-shape nodes (VECTOR / BOOLEAN_OPERATION / STAR /
   *  POLYGON / LINE) whose appearance IS the path geometry: the wrapper keeps
   *  its layout/size classes and this holds the inline `<svg>` rendered from the
   *  node's geometry. Mutually exclusive with `children` (emit ignores children
   *  when set). */
  rawHtml?: string
}

/** Phase 3 §3.x + §3.v4: descriptor for a controlled form control — both
 *  halves of the two-way binding the adapter emits. `read` is the JS
 *  identifier the value attribute references (already in scope as a
 *  `useState` local or a `useDocState` hoist from the scaffold). `write`
 *  identifies the writer the synthesized `onChange` calls; `targetType`
 *  selects the read attr + coercion + onChange source:
 *   - string  → `value={read}` + `e.target.value` (pass-through)
 *   - number  → `value={read}` + `Number(e.target.value)` + `type="number"`
 *   - boolean → `checked={read}` + `e.target.checked` (no coerce; §3.v4
 *     CHECKBOX / SWITCH, single mode)
 *   - array   → per-child `checked={read.includes(<opt>)}` + onChange that
 *     toggles `<opt>` in/out of the array (§3.v4 step 8 CHECKBOX group
 *     mode — only meaningful when the parent has `interactiveProps.options`
 *     so we know which option each child represents).
 *  Per-node-type targetType constraint lives in `resolveValueBinding`. */
export interface IRControlledInput {
  read: string
  write: {
    kind: 'docState' | 'state'
    name: string
    targetType: 'string' | 'number' | 'boolean' | 'array'
  }
}

/** Phase 4 §24.1: a node rendered as an `<img>` (from `interactiveProps.image`).
 *  Exactly one of `srcExpr` / `srcLiteral` is set; `alt` defaults to '' (a valid
 *  decorative-image value). object-fit + aspect-ratio ride the element's
 *  `className`. */
export interface IRImage {
  /** A literal image URL. */
  srcLiteral?: string
  /** A src expression (e.g. a doc-state binding to a §18 upload result). */
  srcExpr?: ExprAst
  alt: string
}

/** Phase 4 §24 v2: binary asset emitted by the compiler project. */
export interface IRAsset {
  path: string
  bytes: Uint8Array
}

/** Phase 4 §21: a FRAME rendered as a user-authored overlay. `openRef` is a
 *  boolean doc-state name; the page hoists it via `useDocState`. When
 *  `closeOnBackdrop` is true, the backdrop writes `false` to the same doc-state
 *  through `setDocState`. */
export interface IROverlay {
  kind: 'modal' | 'drawer' | 'popover' | 'tooltip'
  openRef: string
  closeOnBackdrop: boolean
}

/** Phase 4 §25: external link attrs. Exactly one of `hrefLiteral` /
 *  `hrefExpr` is set. */
export interface IRLink {
  hrefLiteral?: string
  hrefExpr?: ExprAst
  target: '_self' | '_blank' | '_parent' | '_top'
}

/** Phase 4 §23: named lucide-react icon metadata. `name` is the React export
 *  name (PascalCase, e.g. `CameraOff`) after collect validates and normalizes
 *  the authored value against the bundled lucide icon set. */
export interface IRLucideIcon {
  name: string
  size?: number
  color?: string
  strokeWidth?: number
  ariaLabel?: string
}

export interface IRDisplayPrimitive {
  variant?: string
  value?: number
  src?: string
  alt?: string
  fallback?: string
  defaultValue?: string
  /** Phase 4 §22 stateful primitives — optional controlled value wiring for
   *  Tabs / Accordion. Tabs and single Accordion bind a string state; multiple
   *  Accordion binds an array state. */
  valueBinding?: IRControlledInput
  type?: string
  collapsible?: boolean
  items?: IRDisplayItem[]
}

export interface IRDisplayItem {
  value: string
  label: string
  content: string
}

/** Phase 4 §19: a controlled form field's client-side validation rules, lifted
 *  from `interactiveProps.validation`. The data-driven core rules (required /
 *  pattern / length / numeric range) evaluate in the `validateValue` runtime
 *  helper; `custom` is an expression over doc-state (true ≡ valid) evaluated
 *  inline in the page component. */
export interface IRFieldValidation {
  /** Error-map key + the `onBlur` / `onSubmit` validate argument — the field's
   *  SceneNode id (unique across the page). */
  key: string
  /** The doc-/page-state the controlled field writes; this name is read for the
   *  field's value at validate time. */
  stateName: string
  /** Whether `stateName` is a doc-state (read fresh via `getDocStateSnapshot`,
   *  dodging the render-snapshot staleness) or a page-state (read from its
   *  hoisted `useState` local). */
  stateKind: 'docState' | 'state'
  /** Data-driven core rules, JSON-serialized into the page's validators map. */
  rules: IRValidationRules
  /** Optional custom rule: a boolean expression (true ≡ valid) + its message. */
  custom?: IRValidationCustom
}

/** Phase 4 §19: the data-driven core validation rules. Each present rule is
 *  checked in order; the first failure's message (custom or default) is shown.
 *  An empty optional field skips every rule except `required`. */
export interface IRValidationRules {
  required?: boolean
  /** Regular-expression source (validated to compile at collect time). */
  pattern?: string
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  /** Per-rule custom messages; a missing message falls back to a default. */
  messages?: IRValidationMessages
}

export interface IRValidationMessages {
  required?: string
  pattern?: string
  minLength?: string
  maxLength?: string
  min?: string
  max?: string
}

/** Phase 4 §19: a custom validation rule — a boolean expression (over the
 *  field's bound doc-state and other page/doc state; true ≡ valid) plus the
 *  message shown when it fails. */
export interface IRValidationCustom {
  ast: ExprAst
  references: string[]
  message: string
}

export interface IRText {
  kind: 'text'
  /** Literal text content. Adapters apply framework-specific escaping. When
   *  `values` is set (§9 v4 interpolation) this is the ICU message form, e.g.
   *  `Welcome, {name}!`, with `value` doubling as the `defaultMessage`. */
  value: string
  /** Phase 3 §9 — when i18n is enabled, the stable message id this string was
   *  externalized under. The adapter emits `<FormattedMessage id defaultMessage/>`
   *  (with `value` as the default) instead of the literal, and `value` is added
   *  to the locale catalog under this id. Unset when i18n is off. */
  messageId?: string
  /** Phase 3 §9 v4 — interpolation arguments for an ICU message. When the
   *  source text contained `${expr}` placeholders, each is lowered to a named
   *  ICU argument (`{name}` in `value`) plus the expression that fills it. The
   *  adapter emits `<FormattedMessage … values={{ name: <expr> }} />`. Unset for
   *  plain (non-interpolated) messages and when i18n is off. */
  values?: IRMessageValue[]
}

/** Phase 3 §9 v4 — one ICU interpolation argument: the placeholder `name` used
 *  in the message (`{name}`) and the `ast` whose emitted expression fills it at
 *  runtime. */
export interface IRMessageValue {
  name: string
  ast: ExprAst
}

/** A dynamic text node — the adapter emits this as `{<expr>}` rather than a
 *  string literal. Used when a TEXT node's `text` is bound to a state ref or
 *  formula expression. */
export interface IRExpression {
  kind: 'expression'
  /** Pre-parsed AST so the adapter does not re-parse. */
  ast: ExprAst
  /** Identifier names this expression depends on (state variables). */
  references: string[]
  /** Phase 3 §8 v5 — per-variant default literal for a COMPONENT_SET text
   *  prop. When set, the adapter emits `{<expr> ?? "<fallback>"}` so an
   *  un-passed prop falls back to *this* variant subtree's own text (a single
   *  prop spans multiple variant subtrees that may each have a different
   *  default). Unset for normal bindings / plain-component props. */
  fallback?: string
}

/** Phase 3 §9 v3 — an i18n-externalized attribute value (e.g. an INPUT's
 *  `placeholder`). `<FormattedMessage>` is a JSX element and can't sit in an
 *  attribute, so the adapter emits `attr={intl.formatMessage({ id, defaultMessage })}`
 *  and the enclosing function gets a `const intl = useIntl()` hook. `messageId`
 *  is the same content-hash as visible text (`IRText.messageId`) so an identical
 *  string shares one catalog entry. Only produced when i18n is enabled. */
export interface IRIntlAttr {
  kind: 'intlMessage'
  messageId: string
  defaultMessage: string
}

export type IRAttrValue = string | number | boolean | IRIntlAttr

/** Phase 2 §9: conditional render wrapper. Adapter emits
 *  `{(<expr>) && (<consequent>)}`. Only present when the source node's
 *  `renderCondition` parses cleanly AND every referenced identifier is in
 *  scope; failures degrade to the bare `consequent` with a warning. */
export interface IRConditional {
  kind: 'conditional'
  ast: ExprAst
  references: string[]
  consequent: IRNode
}

/** Phase 2 §9: list-rendering directive. Adapter emits
 *  `{(<arrayName>).map((<itemName>, <indexName>) => <template>)}`. Generated
 *  for LIST nodes with a valid array-typed state datasource and at least
 *  one visible child (which becomes the template). */
export interface IRList {
  kind: 'list'
  arrayName: string
  itemName: string
  indexName: string
  template: IRNode
}

/** Phase 4 §18: a file-upload INPUT (Supabase Storage). The adapter emits
 *  `<input type="file">` whose onChange uploads the chosen file to
 *  `storage.from(bucket).upload(path, file, { upsert: true })`, then writes the
 *  public URL of the stored object into `resultTarget` (a doc-state) for a later
 *  form submit / display. `pathAst`, when set, evaluates to a folder prefix the
 *  file name is appended to (e.g. `$currentUser.id` → `<id>/<filename>`);
 *  otherwise the bare file name is used. */
export interface IRUpload {
  bucket: string
  resultTarget: string
  pathAst?: ExprAst
  accept?: string
}

/** Phase 4 §17: one ORDER BY clause on a LIST's Supabase query datasource.
 *  A static column + direction (§17.1), or a reactive `columnAst` / `ascendingAst`
 *  expression (§17.3 dynamic sort) — binding a control to the referenced
 *  doc-state lets the user re-sort the list. `columnAst`, when set, supersedes
 *  the static `column`; `ascendingAst` supersedes `ascending`. */
export interface IRListOrder {
  column: string
  columnAst?: ExprAst
  ascending: boolean
  ascendingAst?: ExprAst
}

/** Phase 4 §17: a LIST node bound directly to a Supabase query (Bubble
 *  "repeating group"). The adapter emits a `const [<rowsName>, <setterName>] =
 *  useState([])` + a `useEffect` that runs
 *  `getSupabaseClient().from(table).select(columns)<filters><order><limit>` and
 *  stores the rows; the LIST's `.map()` then iterates `<rowsName>`. The effect
 *  re-runs whenever a reactive value referenced by a filter changes (`deps`),
 *  so binding a control to a filter's doc-state gives live filtering with no
 *  extra wiring. */
export interface IRListQuery {
  rowsName: string
  setterName: string
  table: string
  columns: string
  filters: IRSupabaseFilter[]
  orderBy: IRListOrder[]
  limit?: number
  /** Phase 4 §17.2: offset pagination. When set (together with `limit`), the
   *  adapter emits `.range(<offset>, <offset> + <limit> - 1)` instead of
   *  `.limit(<limit>)`. The expression typically references a page-index
   *  doc-state the user drives with prev/next setState handlers, so paging
   *  re-runs the fetch (the offset's refs join `deps`). */
  offsetAst?: ExprAst
  /** Reactive dependency expressions for the effect's deps array (page-state /
   *  doc-state value identifiers from filters + offset; `$params` / `$query`
   *  enter stringified so object identity doesn't re-trigger every render). */
  deps: string[]
}

export type IREventName = 'onClick' | 'onChange' | 'onSubmit' | 'onFocus' | 'onBlur'

/** A statement that runs when an event fires. Phase 1 §7.4 widens this
 *  into a discriminated union so the adapter can dispatch on `kind`
 *  exhaustively (and refuse to compile an unknown future kind silently).
 *  Phase 2 §2 lights up the previously-stubbed `setVariable` slot.
 *  Phase 3 §2 adds Supabase {Query,Mutation} for typed DB access. */
export type IREventHandler =
  | IRSetStateHandler
  | IRNavigateHandler
  | IRSetVariableHandler
  | IRApiCallHandler
  | IRSupabaseQueryHandler
  | IRSupabaseMutationHandler
  | IRSupabaseAuthHandler
  | IRConditionalHandler
  | IRDelayHandler
  | IRStopHandler
  | IRToastHandler
  | IRConfirmHandler
  | IRClipboardHandler

/** Phase 2 §2: 'absolute' = adapter emits `setX(<expr>)`; 'functional' =
 *  adapter emits `setX((prev) => <expr-with-$prev-as-prev>)`. The collector
 *  picks the mode by checking the source expression for `$prev`. */
export type ValueUpdateMode = 'absolute' | 'functional'

export interface IRSetStateHandler {
  kind: 'setState'
  /** Variable name of the state being updated (already resolved from stateId). */
  stateName: string
  /** Pre-parsed AST for the new-value expression. In functional mode,
   *  `$prev` has already been rewritten to the chosen parameter name
   *  (`prev`) so adapters can splice the AST verbatim. */
  ast: ExprAst
  /** Identifiers referenced by the expression. In functional mode, the
   *  reserved `$prev` token is stripped — only real state references
   *  remain. */
  references: string[]
  /** Phase 2 §2: functional vs absolute updater emit form. */
  mode: ValueUpdateMode
}

/** Navigate to a route at click time. The collector only emits this when a
 *  router is in scope (multi-page compile); single-page compiles drop the
 *  action with a warning at collect time. */
export interface IRNavigateHandler {
  kind: 'navigate'
  /** Route path, e.g. `/about` or `/product/:id`. Already validated non-empty. */
  to: string
  /** Phase 4 §16.2: resolved values for a dynamic target's route params. Empty /
   *  absent → plain `navigate(to)`; non-empty → `navigate(generatePath(to, {…}))`. */
  params?: IRNavigateParam[]
}

/** Phase 4 §16.2: one resolved `navigate` route param — its name (the `:id`
 *  segment) and the parsed value expression (caller scope). */
export interface IRNavigateParam {
  name: string
  ast: ExprAst
  references: string[]
}

/** Phase 2 §2: writes a document-level state value via the lowcode
 *  runtime (`setDocState(name, value)`). Resolved against
 *  `IRTree.docStates`; unknown `docStateName` is dropped with a warning. */
export interface IRSetVariableHandler {
  kind: 'setVariable'
  /** Name of the DocumentStateDef this handler writes to. */
  docStateName: string
  ast: ExprAst
  references: string[]
  mode: ValueUpdateMode
}

/** Phase 2 §3: fire an HTTP request and write the parsed JSON response into
 *  a Document State via `setDocState(name, data)`. The adapter emits an
 *  async fetch wrapped in try/catch. Resolved against `IRTree.docStates`;
 *  unknown `docStateName` / empty `url` is dropped with a warning. */
export interface IRApiCallHandler {
  kind: 'apiCall'
  method: 'GET' | 'POST'
  /** Phase 2 §4: parsed request-URL template (a `kind:'template'` ExprAst).
   *  A static URL is a degenerate zero-expression template — the adapter
   *  emits it as a plain double-quoted string, byte-identical to §3. */
  url: ExprAst
  /** Validated JSON string for POST requests; undefined for GET. */
  body?: string
  /** Name of the DocumentStateDef the response is written to. */
  docStateName: string
  /** Phase 3 §10 v9 — name of the DocumentStateDef the caught error is written
   *  to (parity with the supabase actions); undefined → error not captured. */
  errorTarget?: string
  /** Phase 3 §10 v9 — result-branch sub-handlers run after the response is
   *  stored (success) / on failure. Nested chains lowered through the same
   *  pipeline so they nest; emitted inside the try success path / catch arm
   *  where `data` / `err` are fresh locals (no render-snapshot staleness). */
  onSuccess?: IREventHandler[]
  onError?: IREventHandler[]
}

/** Phase 3 §2: a single where-clause filter on a Supabase query / mutation.
 *  `ast` is the parsed value expression (same restricted sub-language as
 *  `IRSetStateHandler.ast` / `IRApiCallHandler.url`); adapter emits its JS
 *  value as the second argument to `.eq(column, value)` / `.gt(...)` / etc. */
export interface IRSupabaseFilter {
  column: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in'
  ast: ExprAst
  references: string[]
}

/** Phase 3 §2: typed read against a Supabase table. Adapter emits an
 *  async chain `await getSupabaseClient().from(table).select(columns)
 *  .<filter chain>.<.single()?>` and writes the result into `resultTarget`
 *  (a DocumentStateDef name). Error path writes to `errorTarget` when set. */
export interface IRSupabaseQueryHandler {
  kind: 'supabaseQuery'
  table: string
  /** Comma-separated column list; adapter emits as a JS string literal.
   *  Defaults to `'*'` when the source action's `columns` was undefined. */
  columns: string
  filters: IRSupabaseFilter[]
  single: boolean
  resultTarget: string
  errorTarget?: string
  /** Phase 3 §10 v9 — result-branch sub-handlers (success / error). See
   *  `IRApiCallHandler.onSuccess`; emitted into the `else` / `if (error)` arms. */
  onSuccess?: IREventHandler[]
  onError?: IREventHandler[]
}

/** Phase 3 §3.v2: a single expression-driven payload column. `key` is a
 *  JS identifier (the table column); `ast` is the parsed value expression
 *  (same restricted sub-language as `IRSupabaseFilter.ast`); adapter emits
 *  its JS value as the object-literal value for `<key>:`. */
export interface IRSupabasePayloadEntry {
  key: string
  ast: ExprAst
  references: string[]
}

/** Phase 3 §2: typed write against a Supabase table. One of two payload
 *  channels:
 *    - `payloadEntries` (Phase 3 §3.v2) — expression-based, one entry per
 *      column; supports docState / page-state references.
 *    - `payload` (Phase 3 §2) — compact validated JSON literal,
 *      parsed + re-serialised at collect time like `IRApiCallHandler.body`;
 *      spliced verbatim as a JS object literal.
 *  When source `SupabaseMutationAction` carries both, IR collect emits
 *  `action-supabase-mutation-payload-source-conflict` warning and prefers
 *  `payloadEntries` (decision §3.v2.2 #e). `filters` is the update / delete
 *  where-clause; required by collect for those two operations. */
export interface IRSupabaseMutationHandler {
  kind: 'supabaseMutation'
  operation: 'insert' | 'update' | 'delete' | 'upsert'
  table: string
  payload?: string
  payloadEntries?: IRSupabasePayloadEntry[]
  filters: IRSupabaseFilter[]
  resultTarget?: string
  errorTarget?: string
  /** Phase 3 §10 v9 — result-branch sub-handlers (success / error). See
   *  `IRApiCallHandler.onSuccess`; emitted into the `else` / `if (error)` arms. */
  onSuccess?: IREventHandler[]
  onError?: IREventHandler[]
}

/** Phase 3 §2.v2: sign a user in / out. Phase 3 §2.v3 adds signUp. Phase 3
 *  §2.v4 adds resetPassword + updatePassword. Adapter emits the matching
 *  `await getSupabaseClient().auth.*` call: signInWithPassword / signUp /
 *  signOut / resetPasswordForEmail(email, { redirectTo: window.location.origin })
 *  / updateUser({ password }). `emailAst` is present for signIn / signUp /
 *  resetPassword; `passwordAst` for signIn / signUp / updatePassword (per-op
 *  gating, decision §2.v4.2 b). No `resultTarget`: `$currentUser` stays synced
 *  via the runtime's `onAuthStateChange` (decision §2.v2.2 e). `errorTarget`
 *  optionally captures the auth error. */
export interface IRSupabaseAuthHandler {
  kind: 'supabaseAuth'
  operation: 'signIn' | 'signOut' | 'signUp' | 'resetPassword' | 'updatePassword'
  emailAst?: ExprAst
  passwordAst?: ExprAst
  references: string[]
  errorTarget?: string
}

/** Phase 3 §10: branch a workflow on a runtime condition. `condAst` is the
 *  parsed condition expression (same restricted sub-language as
 *  `IRSetStateHandler.ast`, evaluated for truthiness); the adapter emits
 *  `if (<cond>) { <consequent> } else { <alternate> }`. `consequent` /
 *  `alternate` are nested handler chains lowered through the same pipeline, so
 *  conditions nest. `alternate` is omitted when the source had no falsy branch. */
export interface IRConditionalHandler {
  kind: 'condition'
  condAst: ExprAst
  /** Identifiers referenced by the condition expression (state / docState). */
  references: string[]
  consequent: IREventHandler[]
  alternate?: IREventHandler[]
}

/** Phase 3 §10: pause the workflow. Adapter emits
 *  `await new Promise((resolve) => setTimeout(resolve, ms))`, forcing the
 *  enclosing handler to be `async`. `ms` is validated to a finite non-negative
 *  number at collect time. */
export interface IRDelayHandler {
  kind: 'delay'
  ms: number
}

/** Phase 3 §10: stop the workflow early. Adapter emits `return`. */
export interface IRStopHandler {
  kind: 'stop'
}

/** Phase 3 §10 v2: show a transient toast. The adapter emits
 *  `__opToast(<message>, <variant?>)` against the auto-mounted `<ToastHost/>`
 *  runtime. `ast` is the parsed message expression (same restricted sub-language
 *  as `IRSetStateHandler.ast`, evaluated to a string at runtime); `variant`
 *  selects the severity styling (the second arg is omitted when `info`). */
export interface IRToastHandler {
  kind: 'toast'
  ast: ExprAst
  /** Identifiers the message expression depends on (state / docState). */
  references: string[]
  variant: 'info' | 'success' | 'error'
  /** Phase 3 §10 v5: screen corner (default 'bottom-right' applied at runtime
   *  when absent). Mirrors `ToastPosition` from scene-graph, inlined like
   *  `variant` to keep the IR free of a scene-graph import. */
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
  /** Phase 3 §10 v5: auto-dismiss delay in ms (default 3000 applied at runtime
   *  when absent). */
  durationMs?: number
}

/** Phase 3 §10 v3: gate a workflow on a runtime user confirmation. The adapter
 *  emits `if (await __opConfirm(<message>)) { <consequent> } else { <alternate> }`
 *  against the auto-mounted `<ConfirmHost/>` runtime, so confirm is a
 *  `condition` whose predicate is a user choice (the `await` forces the
 *  enclosing handler async). `ast` is the parsed prompt-message expression
 *  (same restricted sub-language as `IRSetStateHandler.ast`); `consequent` /
 *  `alternate` are nested handler chains lowered through the same pipeline, so
 *  confirms nest. `alternate` is omitted when the source had no cancel branch. */
export interface IRConfirmHandler {
  kind: 'confirm'
  ast: ExprAst
  /** Identifiers the message expression depends on (state / docState). */
  references: string[]
  consequent: IREventHandler[]
  alternate?: IREventHandler[]
  /** Phase 3 §10 v5: custom button labels (default 'OK' / 'Cancel' applied at
   *  runtime when absent). Static strings. */
  confirmLabel?: string
  cancelLabel?: string
}

/** Phase 3 §10 v3: copy a value to the clipboard. The adapter emits
 *  `navigator.clipboard.writeText(<value>)` (fire-and-forget, not awaited).
 *  `ast` is the parsed value expression (same restricted sub-language as
 *  `IRSetStateHandler.ast`, evaluated to a string at runtime). */
export interface IRClipboardHandler {
  kind: 'clipboard'
  ast: ExprAst
  /** Identifiers the value expression depends on (state / docState). */
  references: string[]
}

/** A page-level state declaration. Adapter emits `useState(defaultValue)`. */
export interface IRStateDecl {
  /** Underlying StateDef id. Adapters do not need it, but it helps debug. */
  id: string
  /** Variable name in emitted code (must be a valid JS identifier). */
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  /** Default value used to seed `useState(...)`. */
  defaultValue: unknown
  /** Raw author expression, kept only through collect-time resolution. */
  computedExpr?: string
  /** Phase 4 §27.2: read-only derived page state emitted as `useMemo`. */
  computed?: {
    ast: ExprAst
    references: string[]
  }
  /** Invalid computed expressions degrade to a read-only default fallback. */
  computedInvalid?: true
  /** Phase 4 §27.1: when true on a document-level state, the React runtime
   *  seeds it from localStorage and writes changes back. Ignored for page
   *  state. */
  persist?: boolean
  /** Optional localStorage key override for persisted document state. */
  storageKey?: string
  /** Optional version string; mismatches cause the runtime to ignore old data. */
  storageVersion?: string
}

/** Phase 2 §2: a document-level state declaration. Structurally identical to
 *  `IRStateDecl`, but the adapter emits these into the lowcode runtime store
 *  (`src/_lowcode_state.ts`) rather than into per-page `useState` calls. */
export type IRDocStateDecl = IRStateDecl

export interface IRTree {
  /** SceneNode id of the page (CANVAS) this tree was derived from. */
  pageId: string
  /** Page name from the scene graph. Currently unused by the adapter, but
   *  reserved for multi-page routing in Phase 1. */
  pageName: string
  /** Phase 4 §16.1: page-level dynamic route pattern (e.g. `/product/:id`),
   *  lifted + validated from the page node's `lowcodeRoutePattern`. When set,
   *  the multi-page router emits `<Route path="<pattern>">` instead of the
   *  slug-derived path. Undefined ≡ slug-derived route. */
  routePattern?: string
  /** Phase 4 §16.1: true when any page expression reads a route parameter via
   *  `$params.<name>`. The multi-page adapter then emits a
   *  `const $params = useParams()` hook + the `useParams` import. */
  usesRouteParams: boolean
  /** Phase 4 §16.4: true when any page expression reads a query-string param via
   *  `$query.<name>`. The multi-page adapter then emits a
   *  `const $query = Object.fromEntries(useSearchParams()[0])` hook + the
   *  `useSearchParams` import. Optional ≡ false (keeps IRTree stubs valid). */
  usesQueryParams?: boolean
  /** Phase 4 §16.3: true when the page is auth-guarded — lifted from the page
   *  node's `lowcodeRequiresAuth` AND `$currentUser` exists (Supabase configured).
   *  The multi-page adapter emits a redirect-if-unauthenticated `<Navigate>` at
   *  the top of the page module. Undefined ≡ public page. */
  requiresAuth?: boolean
  /** Phase 4 §16.3: the login route the auth guard redirects to (from the root's
   *  `lowcodeAuthRedirect`, default `/login`). Set only when `requiresAuth`. */
  authRedirect?: string
  /** Top-level children of the page. */
  children: IRNode[]
  /** Page-scoped state declarations the adapter must hoist into the component. */
  states: IRStateDecl[]
  /** Phase 2 §2: every document-level state declaration; identical across
   *  every `IRTree` from the same compile. The adapter scaffolds the
   *  zustand store from this list once. */
  docStates: IRDocStateDecl[]
  /** Phase 2 §2: doc-state names this page READS via a `kind: 'docState'`
   *  binding. Adapter emits one `const x = useDocState('x')` per name at
   *  the top of the page component so the IRExpression's `ident(x)` AST
   *  resolves to a real local. */
  docStateReads: string[]
  /** Phase 2 §2: doc-state names this page WRITES via a `setVariable`
   *  action. Adapter imports `setDocState` when this list is non-empty;
   *  no hook declaration is needed (setDocState is a plain function). */
  docStateWrites: string[]
  /** Phase 4 §17: LIST nodes on this page bound to a Supabase query datasource.
   *  The adapter emits one fetch hook (useState + useEffect) per entry, then the
   *  LIST `.map()` iterates the hook's rows. Empty / absent ≡ no data-bound
   *  lists (every LIST still binds local array state as before). */
  listQueries?: IRListQuery[]
  /** Phase 4 §19: controlled form fields on this page carrying validation rules.
   *  The adapter emits a `validateValue` import, a page-level errors `useState`,
   *  a `__validators` map (one entry per field), and `__validateField` /
   *  `__validateFields` helpers the field `onBlur`s and form `onSubmit`s call.
   *  Empty / absent ≡ no validated fields (→ byte-identical output). */
  validatedFields?: IRFieldValidation[]
  /** Phase 3 §2: connection settings from the root SceneNode, lifted into
   *  every IRTree from the same compile. Adapter uses this to decide
   *  whether to emit `_lowcode_supabase.ts` and inject the supabase-js
   *  dependency. Undefined when the document has no Supabase wiring. */
  supabaseConfig?: IRSupabaseConfig
  /** Phase 3 §9 v7: document-level translation catalog from the root SceneNode,
   *  lifted into every IRTree from the same compile. The adapter pre-fills each
   *  target `locales/<code>.json` from this (missing entries fall back to the
   *  source string). Keyed by locale code → source message → translated string.
   *  Undefined when the document has no authored translations. */
  translations?: IRTranslations
  /** Warnings raised while collecting the IR (invalid bindings, expressions, etc.). */
  warnings: IRWarning[]
  /** Binary assets referenced by this page tree. */
  assets?: IRAsset[]
}

/** Phase 3 §9 v7: IR-local mirror of `LowcodeTranslations` from scene-graph, so
 *  the adapter layer never reaches into core. Locale code → (source message
 *  string → translated string). */
export type IRTranslations = Record<string, Record<string, string>>

/** Phase 3 §2: IR-local mirror of `SupabaseConfig` from scene-graph, so the
 *  adapter layer never has to reach into core. Same shape — anonKey is the
 *  public anon JWT (safe per Supabase RLS design); `schema` defaults to
 *  `'public'` at runtime. */
export interface IRSupabaseConfig {
  url: string
  anonKey: string
  schema?: string
}

export interface IRWarning {
  code: string
  message: string
  nodeId?: string
}
