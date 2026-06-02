import type { SceneGraph } from '@open-pencil/core/scene-graph'

export interface CompilerInput {
  graph: SceneGraph
  /**
   * Page node IDs to compile. All entries are honored — Phase 1 §11 promoted
   * the React adapter from "first only" to multi-page with react-router-dom
   * v6. Single-entry input keeps the legacy single-`App.tsx` shape; multi-
   * entry input emits a router shell + `src/pages/<slug>.tsx` per page.
   */
  pageIds: string[]
  options: CompilerOptions
}

export interface CompilerOptions {
  /** package.json `name` field of the output project */
  packageName: string
  /**
   * Target framework. Phase 0 only ships React; `'vue'` is a reserved enum
   * value that returns a `target-not-implemented` warning at compile time.
   * See docs/lowcode-phase-0.md §8 decision #1.
   */
  target: 'react' | 'vue'
  /** React major version to target. Applies when `target === 'react'`. */
  reactVersion: '18' | '19'
  /** Router strategy. Phase 0 is single-page only (`none`). */
  router: 'react-router-v6' | 'vue-router-v4' | 'none'
  /** Phase 0 always emits TypeScript */
  typescript: true
  /**
   * Emit the canvas↔preview bridge hooks: `data-node-id` attributes on every
   * element + a small `__preview-bridge.ts` runtime that round-trips
   * selection over `window.postMessage`. The in-editor preview pane runs with
   * this on; the one-shot CLI export passes `false` so distributables stay
   * clean. See docs/lowcode-phase-0.md §5.4.
   */
  devMode: boolean
  /**
   * Phase 3 §9 — emit an i18n runtime (react-intl). When true, every visible
   * design string (TEXT content, BUTTON text, SELECT/RADIO/CHECKBOX option
   * labels) is externalized into `src/locales/<source>.json` and rendered via
   * `<FormattedMessage>`, the app is wrapped in an `<I18nProvider>`, and
   * `react-intl` is added to the emitted `package.json`. Default false → output
   * is byte-identical to a non-i18n compile. Optional so existing call sites
   * (and `withDefaults`) stay unbroken.
   */
  i18n?: boolean
}

export interface CompileWarning {
  /** Stable code so callers can suppress / categorize */
  code: string
  message: string
  nodeId?: string
}

export interface CompilerOutput {
  /** Relative path → file content. Text files use string; binary use Uint8Array. */
  files: Map<string, string | Uint8Array>
  warnings: CompileWarning[]
}
