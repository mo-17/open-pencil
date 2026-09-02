import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { BackendCompilationMode, BackendProviderSelection } from './backend/contracts'
import type { OpenPencilMicrofrontendAppV1 } from './microfrontend/types'

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
  /**
   * Resolved, caller-owned web-font assets for this compile. Font discovery is
   * asynchronous (and environment-specific), while `compile()` deliberately
   * stays synchronous and deterministic, so app/CLI callers resolve this plan
   * first with `resolveCompilerWebFonts()` and pass the result here.
   */
  fontManifest?: CompilerFontManifest
}

export type CompilerFontFormat = 'woff2' | 'woff' | 'opentype' | 'truetype'

export type CompilerFontLicenseEvidence =
  | {
      kind: 'provider_policy'
      policyUrl: string
      policyCheckedAt: string
    }
  | {
      kind: 'verified_open'
      licenseIds: string[]
    }
  | {
      kind: 'restricted'
      restriction: 'embedding'
      /** Raw OpenType OS/2 fsType value proving the embedding restriction. */
      fsType: number
    }

export interface CompilerFontFaceAsset {
  family: string
  weight: string | number | [number, number]
  style: string
  display?: string
  stretch?: string
  unicodeRange?: string[]
  format: CompilerFontFormat
  /** Project-relative path. Compiler-generated plans use `src/assets/fonts/*`. */
  path: string
  content: Uint8Array
  /** Source catalog, when the face was downloaded from an online provider. */
  sourceProvider?: string
  /** Redistribution evidence. Provider policy is intentionally weaker than an exact font license. */
  licenseEvidence?: CompilerFontLicenseEvidence
}

export interface CompilerFontManifest {
  /** Actual faces found by the resolver. A requested 700 face may resolve to 400. */
  faces: CompilerFontFaceAsset[]
  /** Ordered script fallbacks after authored family → Inter, matching the canvas stack. */
  fallbackFamilies?: string[]
}

export type CompilerTarget =
  | 'react'
  | 'vue'
  | 'expo'
  | 'flutter'
  | 'wechat-miniprogram'
  | 'taro'
  | 'uni-app'
  | 'mpx'

export type MiniProgramCompilerTarget = Extract<
  CompilerTarget,
  'wechat-miniprogram' | 'taro' | 'uni-app' | 'mpx'
>

export type CompilerRouter =
  | 'react-router-v6'
  | 'vue-router-v4'
  | 'expo-router'
  | 'flutter-router'
  | 'wechat-native'
  | 'taro-router'
  | 'uni-pages'
  | 'mpx-router'
  | 'none'

/**
 * Exact data-only Backend Provider authority prepared by a trusted host for one
 * compile. The Compiler still revalidates the selection against its static
 * adapter registry and normalizes the application before plan/emit; it never
 * receives the host store, credentials, network handles, or executable plugin
 * code through this contract.
 */
export interface CompilerBackendProviderRequest {
  readonly selection: BackendProviderSelection
  readonly application: BackendApplicationSpecV1
}

export interface CompilerOptions {
  /** package.json `name` field of the output project */
  packageName: string
  /** Human-readable application name used by native targets. Web targets ignore it. */
  productName?: string
  /**
   * Output target. React and Vue emit web projects; Expo, Flutter, and the
   * mini-program targets emit source-only projects with explicit capability
   * and degradation contracts.
   */
  target: CompilerTarget
  /** React major version to target. Applies when `target === 'react'`. */
  reactVersion: '18' | '19'
  /** Router strategy. Each implemented target validates its own compatible value. */
  router: CompilerRouter
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
   * Explicit Backend capability policy. Omit to derive `preview` from
   * `devMode:true` and `production` from `devMode:false`. Targets that only
   * emit a static prototype must opt into `source-only-prototype`; production
   * never silently downgrades required Backend behavior.
   */
  backendCompilationMode?: BackendCompilationMode
  /**
   * Host-resolved explicit Backend Provider request. When present it is the
   * only Provider authority for this compile: invalid/inactive authority fails
   * closed and never falls back to legacy Supabase lowering. A document that
   * also contains legacy Backend intent is rejected as ambiguous.
   */
  backendProvider?: CompilerBackendProviderRequest
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
  /**
   * Phase 3 §9 v2 — extra target locale codes (beyond the source `en`). For
   * each, the emit ships a `src/locales/<code>.json` stub (pre-filled with the
   * source strings to translate in place) and registers it in the i18n runtime,
   * plus a `src/components/LocaleSwitcher.tsx`. Only consulted when `i18n` is on
   * and there is text. Empty / unset → source locale only (v1 behavior).
   */
  locales?: string[]
  /**
   * Phase 3 §9 v8 — the design (source) locale: the language the canvas strings
   * are authored in. Defaults to `'en'` when unset/empty. Drives the source
   * catalog filename (`src/locales/<sourceLocale>.json`), the runtime's default
   * locale, and the exclusion seed for `locales` (a target equal to the source
   * is dropped). Only consulted when `i18n` is on. Unset → `'en'` (v7 behavior,
   * byte-identical).
   */
  sourceLocale?: string
  /**
   * Phase 4 §9 v15 — emit RTL-safe logical padding utilities (`ps-*` / `pe-*`)
   * instead of physical left/right utilities for asymmetric auto-layout
   * padding. Default false preserves legacy physical Tailwind output.
   */
  rtlLogicalProperties?: boolean
  /**
   * Phase 3 §15 — emit interactive nodes (BUTTON/INPUT/TEXTAREA/LABEL) as a real
   * code-UI-kit component instead of hand-rolled Tailwind HTML. `'shadcn'` inlines
   * the shadcn/ui sources (`src/components/ui/*` + `src/lib/utils.ts` +
   * `components.json`), adds their deps to package.json, and injects the kit's
   * Tailwind v4 theme into `index.css`. The design's classes pass through via
   * `className`. Default unset → output is byte-identical to the self-contained
   * Tailwind emit. Optional so existing call sites / `withDefaults` stay unbroken.
   */
  uiKit?: UIKitName
  /**
   * Phase 5 §3 — static HTML metadata for the generated SPA shell. Document-level
   * fields apply to `index.html`; `pages` lets a single-page compile override
   * them for the compiled page. Multi-page SPA output still has one HTML shell,
   * so route-specific metadata is intentionally not promised here.
   */
  metadata?: HTMLMetadataOptions
  /**
   * Phase 5 §5 — optional CSS custom-property theme block appended to
   * `src/index.css` after the Tailwind import. `compile()` auto-populates this
   * from SceneGraph variables when the caller leaves it unset; explicit values
   * are appended after generated design-token CSS so callers can override or
   * add runtime theme hooks without changing document schema.
   */
  themeCss?: string
  /**
   * Phase 5 §5 — generated-app theme switch controls. Theme CSS still emits the
   * provider/runtime when this is disabled; only the visible fixed switch is
   * omitted or repositioned at publish time.
   */
  themeSwitch?: boolean | LowcodeThemeSwitchOptions
  /**
   * Optional project packaging contract. Unset keeps the legacy standalone
   * React/Vue project byte-for-byte unchanged. The microfrontend variant adds
   * a side-effect-free ESM lifecycle entry for an orchestrator-owned build.
   */
  packaging?: CompilerPackaging
}

export interface CompilerMicrofrontendPackaging {
  kind: 'microfrontend'
  /** Stable application identity expected from the host lifecycle context. */
  appId: string
  /** Optional publisher version surfaced by the generated lifecycle descriptor. */
  version?: string
}

export type CompilerPackaging = CompilerMicrofrontendPackaging

/** Phase 3 §15 — supported code-UI-kit identifiers. */
export type UIKitName = 'shadcn'

export type LowcodeThemeSwitchPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface LowcodeThemeSwitchOptions {
  enabled?: boolean
  position?: LowcodeThemeSwitchPosition
}

export interface HTMLMetadata {
  title?: string
  description?: string
  image?: string
  canonicalUrl?: string
  head?: LowcodeHeadMetadata
  customCss?: string
}

export interface HTMLMetadataOptions extends HTMLMetadata {
  pages?: Record<string, HTMLMetadata>
}

export type LowcodeHeadMetaKind = 'name' | 'property' | 'httpEquiv'
export type LowcodeHeadLinkCrossOrigin = 'anonymous' | 'use-credentials'

export interface LowcodeHeadMeta {
  kind: LowcodeHeadMetaKind
  key: string
  content: string
}

export interface LowcodeHeadLink {
  rel: string
  href: string
  as?: string
  type?: string
  media?: string
  crossorigin?: LowcodeHeadLinkCrossOrigin
}

export interface LowcodeHeadMetadata {
  meta?: LowcodeHeadMeta[]
  link?: LowcodeHeadLink[]
  styles?: string[]
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
  /**
   * Explicit ownership for non-browser artifacts mixed into `files`. Provider
   * review material is data-only and must not be treated as executable server
   * workflow source. Omitted when the compile emitted neither category.
   */
  artifactOwnership?: CompilerArtifactOwnership
  /**
   * Present only for an explicit microfrontend compile. The build layer must
   * consume this compiler-owned identity instead of accepting a second set of
   * caller overrides that could make the manifest disagree with the bundle.
   */
  microfrontend?: CompilerMicrofrontendBuildDescriptor
}

export interface CompilerArtifactOwnership {
  /** Provider-owned schema, policy, migration, plan, and review artifacts. */
  backendReviewFiles: readonly string[]
  /** Server workflow deployment sources that require a separate runtime deploy. */
  executableServerWorkflowFiles: readonly string[]
}

export interface CompilerMicrofrontendBuildDescriptor {
  app: OpenPencilMicrofrontendAppV1
  routes: readonly string[]
}
