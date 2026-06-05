import type { IRAttrValue } from '#compiler/ir/types'

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
export type UiKitName = 'shadcn'

export interface UiKitMapping {
  /** JSX component name emitted in place of the HTML tag, e.g. `Button`. */
  component: string
  /** Module specifier it is imported from, e.g. `@/components/ui/button`. The
   *  `@/` alias maps to `src/` (added to the emitted tsconfig + vite config when
   *  a kit is active), so the specifier is the same from every importing file. */
  from: string
}

export interface UiKitAdapter {
  readonly name: UiKitName
  /**
   * Map an interactive element's HTML `tag` to a kit component, or return null
   * to keep the plain HTML tag. `attrs` disambiguates tags that several node
   * types share — e.g. `input` is BUTTON-free but covers text INPUT, CHECKBOX,
   * SWITCH and DATEPICKER; Phase A maps only text-like inputs and leaves
   * checkbox/radio inputs as plain HTML.
   */
  mapTag(tag: string, attrs: Readonly<Record<string, IRAttrValue>>): UiKitMapping | null
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
  themeCss(): string
}
