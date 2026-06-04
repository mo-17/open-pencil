// Shared helpers for the codegen commands (`compile` emits source, `build`
// emits a deployable static bundle). Both load a document, resolve pages,
// derive the package name, run the compiler (devMode:false), and report the
// result the same way — so that orchestration lives here once (经验 A — no
// clone). The per-command difference is only the middle step: write source
// files vs run a Vite build.

import { basename, extname } from 'node:path'
import process from 'node:process'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { CompileWarning, CompilerOutput } from '@open-pencil/compiler'
import type { BuildOptions } from '@open-pencil/compiler/build'
import type { SceneNode } from '@open-pencil/core/scene-graph'

import { bold, fmtList, ok, printError } from '#cli/format'
import { loadDocument } from '#cli/headless'

/** Slugify an arbitrary string into a valid package.json `name`. */
export function sanitizePackageName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  return slug || 'openpencil-output'
}

/** Human-friendly one-line render of a compiler warning. */
export function formatWarning(w: CompileWarning): string {
  const id = w.nodeId ? ` (node ${w.nodeId})` : ''
  return `[${w.code}] ${w.message}${id}`
}

/**
 * Resolve the per-environment Supabase override for `build` / `deploy` (§5):
 * explicit flags win over `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the
 * environment; returns undefined when neither is set so the build keeps the
 * design-time fallback baked into the emitted runtime.
 */
export function resolveBuildEnv(flags: {
  supabaseUrl?: string
  supabaseAnonKey?: string
}): BuildOptions['env'] {
  const url = flags.supabaseUrl ?? process.env.VITE_SUPABASE_URL
  const anonKey = flags.supabaseAnonKey ?? process.env.VITE_SUPABASE_ANON_KEY
  if (url === undefined && anonKey === undefined) return undefined
  const env: NonNullable<BuildOptions['env']> = {}
  if (url !== undefined) env.VITE_SUPABASE_URL = url
  if (anonKey !== undefined) env.VITE_SUPABASE_ANON_KEY = anonKey
  return env
}

export type PageResolution =
  | { ok: true; pageIds: string[] }
  | { ok: false; message: string }

/**
 * Resolve which page ids to compile. With `--page`, restrict to the single
 * matching page (error if absent); otherwise compile every page — the React
 * adapter emits a react-router-dom shell when more than one is present.
 */
export function resolvePageIds(pages: readonly SceneNode[], page?: string): PageResolution {
  if (page) {
    const target = pages.find((p) => p.name === page)
    if (!target) {
      const available = pages.map((p) => `"${p.name}"`).join(', ')
      return { ok: false, message: `Page "${page}" not found. Available pages: ${available || 'none'}.` }
    }
    return { ok: true, pageIds: [target.id] }
  }
  return { ok: true, pageIds: pages.map((p) => p.id) }
}

export interface CompiledDocument {
  compiled: CompilerOutput
  packageName: string
}

/**
 * Front-half of both codegen commands: load the document, resolve pages,
 * derive the package name, and compile (devMode:false — a clean distributable
 * with no canvas↔preview bridge). Prints and `process.exit(1)`s on any failure
 * (no file path, no pages, bad `--page`, throw, or empty output), so callers
 * either get a non-empty CompilerOutput or never return.
 */
export async function loadAndCompile(opts: {
  file?: string
  page?: string
  packageName?: string
  outDir: string
  json?: boolean
  /** Phase 3 §9 v13: enable the react-intl i18n runtime in the emitted project
   *  (externalize display strings, emit locale catalogs + LocaleSwitcher). */
  i18n?: boolean
  /** Target locales beyond the source (each gets a catalog stub + switcher entry). */
  locales?: readonly string[]
  /** The source locale the canvas strings are authored in (default 'en'). */
  sourceLocale?: string
}): Promise<CompiledDocument> {
  if (!opts.file) {
    printError('A document file path is required.')
    process.exit(1)
  }

  const graph = await loadDocument(opts.file)
  const pages = graph.getPages()
  if (pages.length === 0) {
    printError('Document has no pages.')
    process.exit(1)
  }

  const resolved = resolvePageIds(pages, opts.page)
  if (!resolved.ok) {
    printError(resolved.message)
    process.exit(1)
  }

  const packageName = sanitizePackageName(opts.packageName ?? basename(opts.file, extname(opts.file)))

  let compiled: CompilerOutput
  try {
    compiled = compile({
      graph,
      pageIds: resolved.pageIds,
      options: withDefaults({
        packageName,
        devMode: false,
        // Phase 3 §9 v13: i18n is opt-in via CLI flags (else byte-identical to before).
        i18n: opts.i18n === true,
        ...(opts.locales && opts.locales.length > 0 ? { locales: [...opts.locales] } : {}),
        ...(opts.sourceLocale ? { sourceLocale: opts.sourceLocale } : {})
      })
    })
  } catch (e) {
    printError(e)
    process.exit(1)
  }

  if (compiled.files.size === 0) {
    const codes = compiled.warnings.map((w) => w.code).join(', ')
    printError(
      `Compile produced no files${codes ? ` (warnings: ${codes})` : ''}. ` +
        'Aborting before touching the output directory.'
    )
    if (opts.json) {
      console.log(
        JSON.stringify({ outDir: opts.outDir, files: [], warnings: compiled.warnings, packageName }, null, 2)
      )
    }
    process.exit(1)
  }

  return { compiled, packageName }
}

/**
 * Back-half of both codegen commands: report the produced files + warnings.
 * `--json` prints a machine summary; otherwise a human-friendly list plus the
 * command-specific `nextLine` hint (`cd … && npm install` vs `Deploy …`).
 */
export function reportCodegenResult(opts: {
  json?: boolean
  outDir: string
  packageName: string
  files: string[]
  warnings: CompileWarning[]
  verb: string
  nextLine: string
}): void {
  if (opts.json) {
    console.log(
      JSON.stringify(
        { outDir: opts.outDir, packageName: opts.packageName, files: opts.files, warnings: opts.warnings },
        null,
        2
      )
    )
    return
  }

  console.log('')
  console.log(bold(`  ${opts.verb} ${opts.files.length} files into ${opts.outDir}`))
  console.log('')
  console.log(fmtList(opts.files.map((rel) => ({ header: rel }))))

  if (opts.warnings.length > 0) {
    console.log('')
    console.log(bold(`  ${opts.warnings.length} warning(s):`))
    console.log('')
    console.log(fmtList(opts.warnings.map((w) => ({ header: formatWarning(w) }))))
  }

  console.log('')
  console.log(ok(opts.nextLine))
}
