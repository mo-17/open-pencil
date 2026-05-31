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

import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { build } from 'vite'

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
  env?: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }
}

export interface BuildResult {
  /** The directory the bundle was written to. */
  outDir: string
  /** `outDir`-relative paths written, sorted. */
  files: string[]
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

  // Shared with the dev-server: a quiet workspace sub-dir as Vite's root (deps
  // resolve up to the hoisted node_modules; the VFS plugin supplies all source)
  // plus the planted JSX-mode tsconfig.
  const { scanRoot, vfsPrefix } = prepareVfsRoot(workspaceRoot)
  const vfs = inMemoryVFS({ files }, vfsPrefix)

  // §5: override the emitted import.meta.env.VITE_SUPABASE_* fallbacks per
  // environment. Only present keys are defined — omitted ones keep the
  // design-time fallback baked into the runtime.
  const define: Record<string, string> = {}
  if (opts.env?.VITE_SUPABASE_URL !== undefined) {
    define['import.meta.env.VITE_SUPABASE_URL'] = JSON.stringify(opts.env.VITE_SUPABASE_URL)
  }
  if (opts.env?.VITE_SUPABASE_ANON_KEY !== undefined) {
    define['import.meta.env.VITE_SUPABASE_ANON_KEY'] = JSON.stringify(opts.env.VITE_SUPABASE_ANON_KEY)
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

  return { outDir, files: listFiles(outDir).sort() }
}
