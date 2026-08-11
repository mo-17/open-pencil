// Shared helpers for the codegen commands (`compile` emits source, `build`
// emits a deployable static bundle). Both load a document, resolve pages,
// derive the package name, run the compiler (devMode:false), and report the
// result the same way — so that orchestration lives here once (经验 A — no
// clone). The per-command difference is only the middle step: write source
// files vs run a Vite build.

import { basename, extname } from 'node:path'
import process from 'node:process'

import { compile, resolveCompilerWebFonts, withDefaults } from '@open-pencil/compiler'
import type { CompileWarning, CompilerOutput, UiKitName } from '@open-pencil/compiler'
import type { BuildOptions } from '@open-pencil/compiler/build'
import { detectSupabaseSecretKey } from '@open-pencil/core/lowcode-validation'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  routerForCodegenTarget,
  validateCodegenTargetFeatures,
  type CodegenWebTarget
} from '#cli/codegen-target'
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

type SupabaseBuildFlags = Partial<
  Record<'supabaseUrl' | 'supabaseAnonKey' | 'supabaseSchema', string>
>

function inheritedSupabaseBuildFlags(environment: NodeJS.ProcessEnv): SupabaseBuildFlags {
  if (environment.OPENPENCIL_DEPLOY_RUNTIME_MODE === 'explicit') {
    return {
      supabaseUrl: environment.OPENPENCIL_DEPLOY_SUPABASE_URL,
      supabaseAnonKey: environment.OPENPENCIL_DEPLOY_SUPABASE_ANON_KEY,
      supabaseSchema: environment.OPENPENCIL_DEPLOY_SUPABASE_SCHEMA
    }
  }
  return {
    supabaseUrl: environment.VITE_SUPABASE_URL,
    supabaseAnonKey: environment.VITE_SUPABASE_ANON_KEY,
    supabaseSchema: environment.VITE_SUPABASE_SCHEMA
  }
}

function optionalTrim(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function validateSupabaseBuildFlags(flags: SupabaseBuildFlags): void {
  const { supabaseUrl: url, supabaseAnonKey: anonKey, supabaseSchema: schema } = flags
  if (anonKey !== undefined && detectSupabaseSecretKey(anonKey)) {
    throw new Error(
      'Refusing to embed a Supabase secret/service_role key in a client bundle; use a publishable or legacy anon key.'
    )
  }
  if (Boolean(url) !== Boolean(anonKey)) {
    throw new Error(
      'Supabase URL and publishable/anon key overrides must be provided together to avoid mixing projects.'
    )
  }
  if (url !== undefined) validateSupabaseBuildUrl(url)
  if (schema !== undefined && !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(schema)) {
    throw new Error('Supabase schema override must be a plain identifier up to 63 characters.')
  }
}

function validateSupabaseBuildUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Supabase URL override is invalid.')
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('Supabase URL override must be HTTP(S) and must not contain credentials.')
  }
}

function buildSupabaseEnvironment(flags: SupabaseBuildFlags): BuildOptions['env'] {
  const { supabaseUrl: url, supabaseAnonKey: anonKey, supabaseSchema: schema } = flags
  if (url === undefined && anonKey === undefined && schema === undefined) return undefined
  return {
    ...(url === undefined ? {} : { VITE_SUPABASE_URL: url }),
    ...(anonKey === undefined ? {} : { VITE_SUPABASE_ANON_KEY: anonKey }),
    ...(schema === undefined ? {} : { VITE_SUPABASE_SCHEMA: schema })
  }
}

/**
 * Resolve the per-environment Supabase override for `build` / `deploy` (§5):
 * explicit flags win over `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` /
 * `VITE_SUPABASE_SCHEMA` in the environment; returns undefined when none is set
 * so the build keeps the design-time fallbacks baked into the emitted runtime.
 */
export function resolveBuildEnv(
  flags: SupabaseBuildFlags,
  environment: NodeJS.ProcessEnv = process.env
): BuildOptions['env'] {
  const inherited = inheritedSupabaseBuildFlags(environment)
  const resolved = {
    supabaseUrl: optionalTrim(flags.supabaseUrl ?? inherited.supabaseUrl),
    supabaseAnonKey: optionalTrim(flags.supabaseAnonKey ?? inherited.supabaseAnonKey),
    supabaseSchema: optionalTrim(flags.supabaseSchema ?? inherited.supabaseSchema)
  }
  validateSupabaseBuildFlags(resolved)
  return buildSupabaseEnvironment(resolved)
}

export type PageResolution = { ok: true; pageIds: string[] } | { ok: false; message: string }

/**
 * Resolve which page ids to compile. With `--page`, restrict to the single
 * matching page (error if absent); otherwise compile every page. Each web
 * adapter emits its matching router shell when more than one is present.
 */
export function resolvePageIds(pages: readonly SceneNode[], page?: string): PageResolution {
  if (page) {
    const target = pages.find((p) => p.name === page)
    if (!target) {
      const available = pages.map((p) => `"${p.name}"`).join(', ')
      return {
        ok: false,
        message: `Page "${page}" not found. Available pages: ${available || 'none'}.`
      }
    }
    return { ok: true, pageIds: [target.id] }
  }
  return { ok: true, pageIds: pages.map((p) => p.id) }
}

export interface CompiledDocument {
  compiled: CompilerOutput
  packageName: string
  target: CodegenWebTarget
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
  /** Phase 3 §15: emit interactive nodes with a code UI kit (e.g. 'shadcn')
   *  instead of hand-rolled Tailwind HTML. Undefined → plain HTML. */
  uiKit?: UiKitName
  /** Web framework target. Defaults to React for CLI compatibility. */
  target?: CodegenWebTarget
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

  const packageName = sanitizePackageName(
    opts.packageName ?? basename(opts.file, extname(opts.file))
  )
  const target = opts.target ?? 'react'
  try {
    validateCodegenTargetFeatures({ target, i18n: opts.i18n === true, uiKit: opts.uiKit })
  } catch (e) {
    printError(e)
    process.exit(1)
  }

  let compiled: CompilerOutput
  try {
    // Vue source export follows the same fail-closed redistribution policy as
    // the editor exporter: do not start an online resolver only to publish
    // font bytes without complete family-specific license/NOTICE material.
    const fontManifest =
      target === 'vue'
        ? { faces: [] }
        : await resolveCompilerWebFonts({
            graph,
            pageIds: resolved.pageIds
          })
    compiled = compile({
      graph,
      pageIds: resolved.pageIds,
      fontManifest,
      options: withDefaults({
        packageName,
        devMode: false,
        target,
        router: routerForCodegenTarget(target, resolved.pageIds.length),
        // Phase 3 §9 v13: i18n is opt-in via CLI flags (else byte-identical to before).
        i18n: opts.i18n === true,
        ...(opts.locales && opts.locales.length > 0 ? { locales: [...opts.locales] } : {}),
        ...(opts.sourceLocale ? { sourceLocale: opts.sourceLocale } : {}),
        // Phase 3 §15: opt-in UI kit (else byte-identical to before).
        ...(opts.uiKit ? { uiKit: opts.uiKit } : {})
      })
    })
    if (target === 'vue') {
      compiled = {
        ...compiled,
        warnings: [
          {
            code: 'vue-font-assets-omitted',
            message:
              'Vue v1 preserves authored font-family CSS but does not download or embed font binaries; add reviewed font assets and complete redistribution notices to the generated project.'
          },
          ...compiled.warnings
        ]
      }
    }
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
        JSON.stringify(
          {
            outDir: opts.outDir,
            files: [],
            warnings: compiled.warnings,
            packageName,
            target
          },
          null,
          2
        )
      )
    }
    process.exit(1)
  }

  return { compiled, packageName, target }
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
  target?: CodegenWebTarget
}): void {
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          outDir: opts.outDir,
          packageName: opts.packageName,
          ...(opts.target ? { target: opts.target } : {}),
          files: opts.files,
          warnings: opts.warnings
        },
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
