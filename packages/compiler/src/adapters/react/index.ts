import {
  buildGitignore,
  buildIndexCss,
  buildIndexHtml,
  buildMainTsx,
  buildPackageJson,
  buildTsConfig,
  buildViteConfig
} from '#compiler/project'
import type { ComponentDef, IRNode, IRSupabaseConfig, IRTree } from '#compiler/ir/types'
import type { CompilerOptions, CompileWarning } from '#compiler/types'

import type { AdapterEmission, FrameworkAdapter } from '../types'

import { buildComponentModule } from './emit/component'
import { stripNavigateForSinglePage } from './ir-walk'
import { buildLowcodeStateRuntime, ZUSTAND_VERSION } from './lowcode-state'
import {
  buildLowcodeSupabaseRuntime,
  buildSupabaseEnvExample,
  buildViteEnvDts,
  SUPABASE_JS_VERSION
} from './lowcode-supabase'
import { buildPreviewBridge } from './preview-bridge'
import { derivePagePaths, type PagePathInfo } from './route-paths'
import {
  buildAppTsx,
  buildPageModule,
  buildRouterApp,
  PAGE_WRAPPER_CLASSES
} from './scaffold'

/**
 * Pinned alongside `react: ^19.2.0` / `react: ^18.3.1` — `react-router-dom@6`
 * supports both. Lock to 6.27 minimum (the line that added React 19 support)
 * to avoid older v6 versions crashing under `<StrictMode>` in React 19.
 */
const REACT_ROUTER_DOM_VERSION = '^6.27.0'

const LOWCODE_STATE_FILE = 'src/_lowcode_state.ts'
const LOWCODE_SUPABASE_FILE = 'src/_lowcode_supabase.ts'

export const reactAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return irs.length > 1
      ? emitMultiPage(irs, options, components)
      : emitSinglePage(irs[0], options, components)
  }
}

/** Phase 3 §8: emit one `src/components/<Name>.tsx` per reusable component.
 *  Pages reference them via the import prefix set in the scaffold options
 *  (`./components/` single-page, `../components/` multi-page). */
function emitComponentFiles(
  files: Map<string, string | Uint8Array>,
  components: readonly ComponentDef[],
  devMode: boolean
): void {
  for (const def of components) {
    files.set(`src/components/${def.name}.tsx`, buildComponentModule(def, devMode))
  }
}

function emitSinglePage(
  ir: IRTree,
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  // Phase 1 §7.4: navigate handlers require react-router-dom's `useNavigate`,
  // which only exists in the multi-page router shell. Strip them up front and
  // warn — the page body emit then proceeds as if they were never collected.
  const { ir: cleaned, warnings } = stripNavigateForSinglePage(ir)
  const files = new Map<string, string | Uint8Array>()
  const extraDeps: Record<string, string> = {
    ...lowcodeStateExtraDeps(cleaned.docStates),
    ...lowcodeSupabaseExtraDeps(cleaned.supabaseConfig)
  }
  files.set('package.json', buildPackageJson(options, extraDeps))
  // Phase 2 §2: emit the lowcode runtime alongside App.tsx when any
  // DocumentStateDef exists; the page module imports `useDocState` /
  // `setDocState` from `./` (single-page) or `../` (multi-page).
  maybeEmitLowcodeRuntime(files, cleaned.docStates)
  maybeEmitLowcodeSupabaseRuntime(files, cleaned.supabaseConfig)
  emitComponentFiles(files, components, options.devMode)
  files.set(
    'src/App.tsx',
    buildAppTsx(cleaned, {
      devMode: options.devMode,
      lowcodeStateImportPath: './_lowcode_state',
      lowcodeSupabaseImportPath: './_lowcode_supabase',
      componentImportPrefix: './components/'
    })
  )
  setSharedProjectFiles(files, options, collectClassNames([cleaned], components))
  return { files, warnings }
}

function emitMultiPage(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  const infos = derivePagePaths(irs)
  const files = new Map<string, string | Uint8Array>()
  const docStates = irs[0]?.docStates ?? []
  const supabaseConfig = irs[0]?.supabaseConfig
  const extraDeps: Record<string, string> = {
    'react-router-dom': REACT_ROUTER_DOM_VERSION,
    ...lowcodeStateExtraDeps(docStates),
    ...lowcodeSupabaseExtraDeps(supabaseConfig)
  }
  files.set('package.json', buildPackageJson(options, extraDeps))
  maybeEmitLowcodeRuntime(files, docStates)
  maybeEmitLowcodeSupabaseRuntime(files, supabaseConfig)
  emitComponentFiles(files, components, options.devMode)
  files.set('src/App.tsx', buildRouterApp(infos, { devMode: options.devMode }))
  for (const info of infos) {
    files.set(
      `src/pages/${info.file}`,
      buildPageModule(info, {
        devMode: options.devMode,
        lowcodeStateImportPath: '../_lowcode_state',
        lowcodeSupabaseImportPath: '../_lowcode_supabase',
        componentImportPrefix: '../components/'
      })
    )
  }
  setSharedProjectFiles(files, options, collectClassNames(irs, components))
  return { files, warnings: collectSlugWarnings(infos) }
}

function lowcodeStateExtraDeps(
  docStates: readonly IRTree['docStates'][number][]
): Record<string, string> {
  return docStates.length > 0 ? { zustand: ZUSTAND_VERSION } : {}
}

function lowcodeSupabaseExtraDeps(
  config: IRSupabaseConfig | undefined
): Record<string, string> {
  return config ? { '@supabase/supabase-js': SUPABASE_JS_VERSION } : {}
}

function maybeEmitLowcodeRuntime(
  files: Map<string, string | Uint8Array>,
  docStates: readonly IRTree['docStates'][number][]
): void {
  if (docStates.length === 0) return
  files.set(LOWCODE_STATE_FILE, buildLowcodeStateRuntime(docStates))
}

function maybeEmitLowcodeSupabaseRuntime(
  files: Map<string, string | Uint8Array>,
  config: IRSupabaseConfig | undefined
): void {
  if (!config) return
  files.set(LOWCODE_SUPABASE_FILE, buildLowcodeSupabaseRuntime(config))
  // §5: the runtime reads import.meta.env — ship the Vite client types (for the
  // standalone `tsc --noEmit`) and a copy-to-.env override template.
  files.set('src/vite-env.d.ts', buildViteEnvDts())
  files.set('.env.example', buildSupabaseEnvExample(config))
}

/**
 * Project-shape files that are identical between single-page and multi-page
 * emissions. Lives next to the dispatch so it stays in sync with both
 * branches and stops jscpd flagging the otherwise-near-identical setups.
 */
function setSharedProjectFiles(
  files: Map<string, string | Uint8Array>,
  options: CompilerOptions,
  classNames: string[]
): void {
  files.set('vite.config.ts', buildViteConfig())
  files.set('tsconfig.json', buildTsConfig())
  files.set('index.html', buildIndexHtml(options.packageName))
  files.set('src/main.tsx', buildMainTsx())
  files.set('src/index.css', buildIndexCss(classNames))
  files.set('.gitignore', buildGitignore())
  if (options.devMode) {
    files.set('src/__preview-bridge.ts', buildPreviewBridge())
  }
}

function collectSlugWarnings(infos: readonly PagePathInfo[]): CompileWarning[] {
  const warnings: CompileWarning[] = []
  for (const info of infos) {
    if (info.slug === info.originalSlug) continue
    warnings.push({
      code: 'multi-page-duplicate-slug',
      message:
        `Page "${info.ir.pageName}" produced URL slug "${info.originalSlug}" ` +
        `which collided with an earlier page; routed at "${info.route}" instead. ` +
        `Rename the page to silence this warning.`,
      nodeId: info.ir.pageId
    })
  }
  return warnings
}

function collectClassNames(
  irs: readonly IRTree[],
  components: readonly ComponentDef[] = []
): string[] {
  // Seed with the wrapper classes scaffold.ts emits on the page <div>.
  // They never appear in the IR (the wrapper isn't an IRNode), so without
  // this seed Tailwind v4 wouldn't generate them and absolute children lose
  // their reference frame in the VFS-served iframe.
  const acc = new Set<string>(PAGE_WRAPPER_CLASSES)
  for (const ir of irs) {
    for (const child of ir.children) walk(child, acc)
  }
  // Phase 3 §8: component bodies live in their own files, so their classes
  // must reach the safelist too — otherwise an instanced-only component's
  // styles get stripped in the iframe.
  for (const def of components) {
    for (const child of def.children) walk(child, acc)
  }
  return [...acc].sort()
}

function walk(node: IRNode, acc: Set<string>): void {
  // Phase 2 §9: IRConditional / IRList carry no className of their own, but
  // their subtrees do. Without descending here, Tailwind's safelist would miss
  // classes on conditionally-rendered or list-templated elements and the
  // iframe would silently strip their CSS.
  if (node.kind === 'conditional') {
    walk(node.consequent, acc)
    return
  }
  if (node.kind === 'list') {
    walk(node.template, acc)
    return
  }
  // Phase 3 §8: a component ref carries the usage-site root classes.
  if (node.kind === 'componentRef') {
    addClasses(node.className, acc)
    return
  }
  if (node.kind !== 'element') return
  addClasses(node.className, acc)
  for (const child of node.children) walk(child, acc)
}

function addClasses(className: string, acc: Set<string>): void {
  if (!className) return
  for (const cls of className.split(/\s+/)) {
    if (cls) acc.add(cls)
  }
}
