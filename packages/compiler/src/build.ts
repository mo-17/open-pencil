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
import { join, relative } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { build } from 'vite'

import { inMemoryVFS, type PreviewFiles } from './vfs'

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

  // Mirror dev-server: a quiet sub-directory is Vite's root so its dep
  // resolution walks up to the workspace's hoisted node_modules, but its
  // default html/dep scan finds nothing on disk (the VFS plugin supplies
  // everything). The VFS prefix sits inside scanRoot so npm-package
  // resolution from any virtual file reaches scanRoot's node_modules chain.
  const scanRoot = join(workspaceRoot, 'packages/compiler/.preview-root')
  mkdirSync(scanRoot, { recursive: true })
  const vfsPrefix = `${scanRoot}/`
  const vfs = inMemoryVFS({ files }, vfsPrefix)

  // Plant a tsconfig.json that wins the upward search Vite/esbuild does for
  // JSX mode. The workspace root tsconfig sets `jsx: "preserve"` (for Vue);
  // if that wins, esbuild's TS strip rejects the React TSX as invalid JS.
  writeFileSync(
    join(scanRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          allowImportingTsExtensions: false,
          isolatedModules: true,
          strict: true,
          skipLibCheck: true,
          useDefineForClassFields: true
        }
      },
      null,
      2
    )
  )

  await build({
    root: scanRoot,
    base,
    configFile: false,
    envFile: false,
    // Surface real build problems (no-swallow, 经验 C); suppress info spam so
    // the CLI owns the human-facing output.
    logLevel: 'warn',
    plugins: [vfs, react(), tailwindcss()],
    // Same hard JSX override as the dev-server — see scanRoot tsconfig note.
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react',
      tsconfigRaw: {
        compilerOptions: {
          jsx: 'react-jsx',
          jsxImportSource: 'react',
          target: 'esnext',
          useDefineForClassFields: true
        }
      }
    },
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
