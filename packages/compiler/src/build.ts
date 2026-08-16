#!/usr/bin/env bun
// Bun-only. Imports Vite, its React/Vue framework plugins, and Tailwind — none
// safe to load in a browser bundle. The CLI `build` command calls this after
// `compile()` to turn the emitted `Map<path, content>` into a deployable static
// `dist/`.
//
// Phase 3 §5 step 2: the static-build counterpart of `dev-server.ts`. Both feed
// the compiled VFS to Vite through the shared `inMemoryVFS` plugin (./vfs) and
// resolve npm deps from the workspace's hoisted node_modules — so a build needs
// zero `npm install`. Unlike the dev-server (Vite `createServer` + HMR), this
// runs Vite `build` once and writes a hashed static SPA bundle to a real dir.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { build, type PluginOption } from 'vite'

import { detectSupabaseSecretKey } from '@open-pencil/lowcode'

import {
  inMemoryVFS,
  prepareVfsRoot,
  reactViteOptions,
  type PreviewFiles,
  type WebVfsTarget
} from './vfs'

export interface BuildOptions {
  /** Compiled project files — `CompilerOutput.files` (emit with devMode:false
   *  so the deployable bundle carries no canvas↔preview bridge). */
  files: PreviewFiles
  /** Real directory the static `dist/` is written into. */
  outDir: string
  /**
   * Workspace root Vite uses to resolve framework/Tailwind npm deps. Must
   * be a real path so node_modules resolution works. Defaults to
   * `process.cwd()`.
   */
  fsRoot?: string
  /** Public base path for assets. Defaults to '/' (root hosting). */
  base?: string
  /** Framework emitted into `files`. Defaults to React for compatibility. */
  target?: WebVfsTarget
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
export const OPENPENCIL_BUILD_OUTPUT_MANIFEST = '.openpencil-build-output.json'

const BUILD_OUTPUT_MANIFEST_VERSION = 1
const MAX_BUILD_OUTPUT_FILES = 100_000
const MAX_BUILD_OUTPUT_MANIFEST_BYTES = 4 * 1024 * 1024

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

/** Reject secrets before any client build starts writing output. */
export function assertSafeClientBuildEnvironment(env: BuildOptions['env']): void {
  if (
    env?.VITE_SUPABASE_ANON_KEY !== undefined &&
    detectSupabaseSecretKey(env.VITE_SUPABASE_ANON_KEY)
  ) {
    throw new Error(
      'Refusing to embed a Supabase secret/service_role key in a client bundle; use a publishable or legacy anon key.'
    )
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
function listFiles(dir: string, maximumEntries = MAX_BUILD_OUTPUT_FILES): string[] {
  const out: string[] = []
  let entryCount = 0
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      entryCount += 1
      if (entryCount > maximumEntries) {
        throw new Error(`Build output exceeds the ${maximumEntries} entry limit: ${dir}`)
      }
      const child = join(abs, entry.name)
      if (entry.isDirectory()) walk(child)
      else out.push(relative(dir, child))
    }
  }
  walk(dir)
  return out
}

function portableBuildPath(path: string): string {
  return path.replaceAll('\\', '/')
}

function isSafeBuildPath(path: unknown): path is string {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\')
  ) {
    return false
  }
  const segments = path.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function managedBuildOutputFiles(outDir: string): string[] {
  const markerPath = join(outDir, OPENPENCIL_BUILD_OUTPUT_MANIFEST)
  const marker = lstatSync(markerPath)
  if (!marker.isFile() || marker.isSymbolicLink()) {
    throw new Error(`Refusing untrusted OpenPencil build marker in ${outDir}`)
  }
  if (marker.size > MAX_BUILD_OUTPUT_MANIFEST_BYTES) {
    throw new Error(`Refusing oversized OpenPencil build marker in ${outDir}`)
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(readFileSync(markerPath, 'utf8'))
  } catch {
    throw new Error(`Refusing invalid OpenPencil build marker in ${outDir}`)
  }
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate) ||
    Reflect.get(candidate, 'version') !== BUILD_OUTPUT_MANIFEST_VERSION ||
    !Array.isArray(Reflect.get(candidate, 'files'))
  ) {
    throw new Error(`Refusing invalid OpenPencil build marker in ${outDir}`)
  }
  const files = Reflect.get(candidate, 'files') as unknown[]
  if (files.length > MAX_BUILD_OUTPUT_FILES || !files.every(isSafeBuildPath)) {
    throw new Error(`Refusing invalid OpenPencil build marker in ${outDir}`)
  }
  const normalized = [...files].sort()
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Refusing duplicate paths in OpenPencil build marker for ${outDir}`)
  }
  return normalized
}

/**
 * Vite's `emptyOutDir` is intentionally destructive. Only an empty directory or
 * a byte-independent path set recorded by a previous successful OpenPencil
 * build may be replaced. Any extra user file makes the build fail closed.
 */
export function assertSafeBuildOutputDirectory(outDir: string): void {
  if (!existsSync(outDir)) return
  const output = lstatSync(outDir)
  if (!output.isDirectory() || output.isSymbolicLink()) {
    throw new Error(`Build output must be a real directory: ${outDir}`)
  }
  const rootEntries = readdirSync(outDir)
  if (rootEntries.length === 0) return
  if (!rootEntries.includes(OPENPENCIL_BUILD_OUTPUT_MANIFEST)) {
    throw new Error(
      `Refusing to empty non-OpenPencil build directory: ${outDir}. Choose an empty output directory.`
    )
  }
  const expected = managedBuildOutputFiles(outDir)
  const current = listFiles(outDir).map(portableBuildPath).sort()
  const actual = current.filter((path) => path !== OPENPENCIL_BUILD_OUTPUT_MANIFEST)
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new Error(
      `Refusing to empty build directory with files not owned by its OpenPencil manifest: ${outDir}`
    )
  }
}

function writeBuildOutputManifest(outDir: string, files: readonly string[]): void {
  writeFileSync(
    join(outDir, OPENPENCIL_BUILD_OUTPUT_MANIFEST),
    JSON.stringify({ version: BUILD_OUTPUT_MANIFEST_VERSION, files }, null, 2) + '\n'
  )
}

/**
 * Finish an OpenPencil-owned build directory after Vite has written its browser
 * bundle. Server sources bypass Rollup, then the complete output is recorded in
 * the ownership marker used by the next safe rebuild.
 *
 * Microfrontend library builds share this exact boundary with standalone SPA
 * builds so neither path grows a subtly different cleanup or server-artifact
 * policy.
 */
export function completeManagedBuildOutput(files: PreviewFiles, outDir: string): BuildResult {
  copyServerArtifacts(files, outDir)
  return recordManagedBuildOutput(outDir)
}

/** Record a build whose additional verified artifacts were already written by
 * an owning compiler pipeline (for example copied local microfrontends). */
export function recordManagedBuildOutput(outDir: string): BuildResult {
  const written = listFiles(outDir).map(portableBuildPath).sort()
  writeBuildOutputManifest(outDir, written)
  const serverFiles = written.filter(isServerArtifactOutputPath)
  return {
    outDir,
    files: written,
    staticFiles: written.filter((path) => !isServerArtifactOutputPath(path)),
    serverFiles
  }
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
  const target = opts.target ?? 'react'

  assertSafeBuildOutputDirectory(outDir)

  assertSafeClientBuildEnvironment(opts.env)

  // Shared with the dev-server: a quiet workspace sub-dir as Vite's root (deps
  // resolve up to the hoisted node_modules; the VFS plugin supplies all source)
  // plus the planted JSX-mode tsconfig.
  const { scanRoot, vfsPrefix } = prepareVfsRoot(workspaceRoot, target)
  // Server sources are never visible to Vite, even if a malformed browser
  // entry tries to import one. They are copied to the separate bundle below.
  const vfs = inMemoryVFS({ files: browserPreviewFiles(files) }, vfsPrefix)
  const frameworkPlugins: PluginOption[] =
    target === 'vue' ? [vue() as PluginOption] : (react() as PluginOption[])

  // §5: explicit CLI/app overrides win. Missing keys are pinned to undefined
  // instead of letting Vite inherit an unrelated build-process VITE_* value.
  const define = {
    ...createSupabaseBuildDefines(opts.env),
    'process.env.NODE_ENV': JSON.stringify('production')
  }

  await build({
    root: scanRoot,
    base,
    configFile: false,
    envFile: false,
    define,
    // Surface real build problems (no-swallow, 经验 C); suppress info spam so
    // the CLI owns the human-facing output.
    logLevel: 'warn',
    plugins: [vfs, ...frameworkPlugins, ...tailwindcss()],
    ...(target === 'react' ? reactViteOptions(false) : {}),
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
  return completeManagedBuildOutput(files, outDir)
}
