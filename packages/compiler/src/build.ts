#!/usr/bin/env bun
// Bun-only. Imports `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` — none
// safe to load in a browser bundle. The CLI `build` command calls this after
// `compile()` to turn the emitted `Map<path, content>` into a deployable
// static `dist/`.
//
// Phase 3 §5 step 2: the static-build counterpart of `dev-server.ts`. Both feed
// the compiled VFS to Vite through the shared `inMemoryVFS` plugin (./vfs) and
// resolve npm deps from the workspace's hoisted node_modules — so a build needs
// zero `npm install`. Unlike the dev-server (Vite `createServer` + HMR), this
// runs Vite `build` once and writes a hashed static SPA bundle to a real dir.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { build } from 'vite'

import { detectSupabaseSecretKey } from '@open-pencil/core/lowcode-validation'

import { inMemoryVFS, prepareVfsRoot, VITE_JSX_ESBUILD, type PreviewFiles } from './vfs'

export interface BuildOptions {
  /** Compiled project files — `CompilerOutput.files` (emit with devMode:false
   *  so the deployable bundle carries no canvas↔preview bridge). */
  files: PreviewFiles
  /** Real directory the static `dist/` is written into. */
  outDir: string
  /**
   * Workspace root Vite uses to resolve npm deps (react / tailwind / …). Must
   * be a real path so node_modules resolution works. Defaults to
   * `process.cwd()`.
   */
  fsRoot?: string
  /** Public base path for assets. Defaults to '/' (root hosting). */
  base?: string
  /**
   * Build-time Supabase env override (§5). Each present key is fed to Vite as a
   * `define` for `import.meta.env.VITE_SUPABASE_*`; omitted keys fall back to
   * the design-time values baked into the emitted runtime. The VFS build can't
   * read a disk `.env`, so this is the override channel for our pipeline.
   */
  env?: {
    VITE_SUPABASE_URL?: string
    VITE_SUPABASE_ANON_KEY?: string
    VITE_SUPABASE_SCHEMA?: string
  }
}

export interface BuildResult {
  /** The directory the bundle was written to. */
  outDir: string
  /** All `outDir`-relative paths written, sorted. */
  files: string[]
  /** Browser-static paths that are safe to send to a static hosting provider. */
  staticFiles: string[]
  /** Server-only paths delivered under `openpencil-server/`, never for static upload. */
  serverFiles: string[]
}

/** Non-secret operator instructions returned when a build contains server
 * artifacts that static hosting must not upload. */
export interface ServerDeploymentInstructions {
  required: true
  warning: string
  artifactDirectory: string
  commands: string[]
}

export const OPENPENCIL_SERVER_OUTPUT_DIR = 'openpencil-server'

const SERVER_ARTIFACT_FILES = new Set([
  '.env.server.example',
  'openpencil-server.manifest.json',
  'SERVER_DEPLOYMENT.md'
])

/** Server-only compiler sources that must bypass Vite and static hosting. */
export function isServerArtifactSourcePath(path: string): boolean {
  return path.startsWith('supabase/') || SERVER_ARTIFACT_FILES.has(path)
}

/** Build output paths that belong to the separately deployed server bundle. */
export function isServerArtifactOutputPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return normalized.startsWith(`${OPENPENCIL_SERVER_OUTPUT_DIR}/`)
}

/**
 * Pin all client Supabase variables at the Vite define boundary. An omitted
 * override is deliberately `undefined` so an ambient build-process VITE_* value
 * cannot replace the design-time fallback emitted by the compiler.
 */
export function createSupabaseBuildDefines(env: BuildOptions['env']): Record<string, string> {
  return {
    'import.meta.env.VITE_SUPABASE_URL':
      env?.VITE_SUPABASE_URL === undefined ? 'undefined' : JSON.stringify(env.VITE_SUPABASE_URL),
    'import.meta.env.VITE_SUPABASE_ANON_KEY':
      env?.VITE_SUPABASE_ANON_KEY === undefined
        ? 'undefined'
        : JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
    'import.meta.env.VITE_SUPABASE_SCHEMA':
      env?.VITE_SUPABASE_SCHEMA === undefined
        ? 'undefined'
        : JSON.stringify(env.VITE_SUPABASE_SCHEMA)
  }
}

function copyServerArtifacts(files: PreviewFiles, outDir: string): void {
  for (const [path, contents] of files) {
    if (!isServerArtifactSourcePath(path)) continue
    const segments = path.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error(`Refusing unsafe server artifact path: ${path}`)
    }
    const destination = join(outDir, OPENPENCIL_SERVER_OUTPUT_DIR, ...segments)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, contents)
  }
}

function browserPreviewFiles(files: PreviewFiles): PreviewFiles {
  const browserFiles: PreviewFiles = new Map()
  for (const [path, contents] of files) {
    if (!isServerArtifactSourcePath(path)) browserFiles.set(path, contents)
  }
  return browserFiles
}

/** Recursively list files under `dir`, returning `dir`-relative POSIX-ish paths. */
function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, entry.name)
      if (entry.isDirectory()) walk(child)
      else out.push(relative(dir, child))
    }
  }
  walk(dir)
  return out
}

/**
 * Build the emitted project into a static `dist/` bundle. Resolves a free
 * Vite build against the in-memory VFS (no files written for the source);
 * only the final bundle lands on disk under `outDir`.
 */
export async function buildPreviewProject(opts: BuildOptions): Promise<BuildResult> {
  const { files, outDir } = opts
  const workspaceRoot = opts.fsRoot ?? process.cwd()
  const base = opts.base ?? '/'

  if (
    opts.env?.VITE_SUPABASE_ANON_KEY !== undefined &&
    detectSupabaseSecretKey(opts.env.VITE_SUPABASE_ANON_KEY)
  ) {
    throw new Error(
      'Refusing to embed a Supabase secret/service_role key in a client bundle; use a publishable or legacy anon key.'
    )
  }

  // Shared with the dev-server: a quiet workspace sub-dir as Vite's root (deps
  // resolve up to the hoisted node_modules; the VFS plugin supplies all source)
  // plus the planted JSX-mode tsconfig.
  const { scanRoot, vfsPrefix } = prepareVfsRoot(workspaceRoot)
  // Server sources are never visible to Vite, even if a malformed browser
  // entry tries to import one. They are copied to the separate bundle below.
  const vfs = inMemoryVFS({ files: browserPreviewFiles(files) }, vfsPrefix)

  // §5: explicit CLI/app overrides win. Missing keys are pinned to undefined
  // instead of letting Vite inherit an unrelated build-process VITE_* value.
  const define = createSupabaseBuildDefines(opts.env)

  await build({
    root: scanRoot,
    base,
    configFile: false,
    envFile: false,
    define,
    // Surface real build problems (no-swallow, 经验 C); suppress info spam so
    // the CLI owns the human-facing output.
    logLevel: 'warn',
    plugins: [vfs, react(), tailwindcss()],
    esbuild: VITE_JSX_ESBUILD,
    build: {
      outDir,
      emptyOutDir: true,
      // No disk index.html to auto-discover — point Vite at the VFS-resolved
      // html entry explicitly (it resolves through inMemoryVFS.resolveId).
      rollupOptions: { input: vfsPrefix + 'index.html' }
    }
  })

  // Server workflows are emitted beside the browser project in the VFS, but
  // they must not enter Rollup or a static-host upload. Preserve them as a
  // separate operator-owned bundle instead.
  copyServerArtifacts(files, outDir)

  const written = listFiles(outDir).sort()
  const serverFiles = written.filter(isServerArtifactOutputPath)
  return {
    outDir,
    files: written,
    staticFiles: written.filter((path) => !isServerArtifactOutputPath(path)),
    serverFiles
  }
}
