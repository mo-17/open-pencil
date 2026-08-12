import type { IRAttrValue, IRElement, IRNode } from '#compiler/ir/types'

/**
 * Phase 3 §15 — pluggable code-UI-kit adapter. When `CompilerOptions.uiKit` is
 * set, the React adapter rewrites interactive design nodes (BUTTON/INPUT/…) to
 * import and render a real component-library component (shadcn/ui first) instead
 * of a hand-rolled `<button className>` etc. The design's Tailwind classes pass
 * through via `className`, so the kit supplies behavior + a11y while the design
 * keeps its look.
 *
 * Default (unset) → byte-identical to the self-contained Tailwind emit.
 */

/** The supported kit identifiers (`CompilerOptions.uiKit` / CLI `--ui-kit`). */
export type UIKitName = 'shadcn'

export interface UIKitMapping {
  /** JSX component name emitted in place of the HTML tag, e.g. `Button`. Also
   *  the key into the kit's component-file/deps registry (drives which source
   *  files + npm deps the kit emits). */
  component: string
  /** Module specifier it is imported from, e.g. `@/components/ui/button`. The
   *  `@/` alias maps to `src/` (added to the emitted tsconfig + vite config when
   *  a kit is active), so the specifier is the same from every importing file. */
  from: string
  /** Phase 3 §15 Phase B — the named exports to import from `from`. A composed
   *  control needs several (shadcn Select pulls
   *  `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` from one
   *  module). Defaults to `[component]` when omitted (Phase A 1:1 components). */
  imports?: readonly string[]
}

/** Phase 3 §15 Phase B — helpers a UI-kit adapter's `emitControl` uses to emit
 *  a composed control. `emitChild` delegates to the React adapter's element
 *  emitter (so nested i18n `<FormattedMessage>` / expression children render
 *  correctly); `escapeAttr` quotes a `className`/attr value the kit's way. */
export interface KitEmitCtx {
  /** Two-space indent units for the control's root line (matches `emitElement`). */
  indent: number
  /** When true the root component gets `data-node-id` for the preview bridge. */
  devMode: boolean
  /** Emit a child IR node (text/expression/element) at `indent`, returning the
   *  full padded JSX line(s) — used for option labels (kept i18n-aware). */
  emitChild(node: IRNode, indent: number): string
  /** Escape a string for a double-quoted JSX attribute value. */
  escapeAttr(value: string): string
}

export interface UIKitAdapter {
  readonly name: UIKitName
  /**
   * Map an interactive element's HTML `tag` to a kit component, or return null
   * to keep the plain HTML tag. `attrs` disambiguates tags that several node
   * types share — e.g. `input` is BUTTON-free but covers text INPUT, CHECKBOX,
   * SWITCH and DATEPICKER; Phase A maps only text-like inputs and leaves
   * checkbox/radio inputs as plain HTML.
   */
  mapTag(tag: string, attrs: Readonly<Record<string, IRAttrValue>>): UIKitMapping | null
  /**
   * Phase 3 §15 Phase B — resolve a marked form control (`node.controlKind`) to
   * its kit component mapping (for import + file/dep collection), or null to
   * leave it as plain HTML. Distinct from `mapTag` because these controls are
   * identified by their semantic `controlKind` (a RADIO/checkbox-group wrapper
   * is an unmarked `<div>`), not their HTML tag.
   */
  mapControl?(kind: NonNullable<IRElement['controlKind']>): UIKitMapping | null
  /**
   * Phase 3 §15 Phase B — emit the full JSX for a marked control as a composed
   * kit component (e.g. `<Select><SelectTrigger>…`). Returns null to fall back
   * to the plain-HTML emit. The adapter owns the event-API translation
   * (`onChange` → `onValueChange`/`onCheckedChange`) and composition markup.
   */
  emitControl?(node: IRElement, ctx: KitEmitCtx): string | null
  /**
   * Phase 4 §15.1 — resolve a card-like container element (`node.containerKind`)
   * to its kit component mapping, or null to keep the plain `<div>`. Unlike
   * `mapControl`, a container only renames the tag (`<div>` → `<Card>`) and
   * keeps emitting its children inside — there is no composed-markup hook.
   */
  mapContainer?(kind: NonNullable<IRElement['containerKind']>): UIKitMapping | null
  /** Phase 4 §22 — resolve a display primitive hint to a kit component mapping.
   *  Simple primitives only rename the tag; composed primitives can additionally
   *  be emitted through `emitDisplay`. */
  mapDisplay?(kind: NonNullable<IRElement['displayKind']>): UIKitMapping | null
  /** Phase 4 §22 — emit a display primitive with custom composition, such as
   *  AvatarImage/Fallback or Progress value. Return null to use normal tag
   *  replacement through `mapDisplay`. */
  emitDisplay?(node: IRElement, ctx: KitEmitCtx): string | null
  /**
   * Inline component-source files for the used component names (e.g. `Button`),
   * keyed by output path (`src/components/ui/button.tsx`). Only the components
   * actually rendered are emitted.
   */
  componentFiles(used: ReadonlySet<string>): Map<string, string>
  /** Files always emitted when the kit is active (lib/utils.ts, components.json). */
  sharedFiles(): Map<string, string>
  /** npm dependencies for the used components + shared helpers, merged into the
   *  emitted package.json. */
  deps(used: ReadonlySet<string>): Record<string, string>
  /** Tailwind v4 theme CSS (CSS variables + `@theme` mapping + base layer) merged
   *  into `src/index.css` so the kit's semantic color utilities resolve. */
  themeCSS(): string
}
