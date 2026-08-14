#!/usr/bin/env bun

import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { build, type PluginOption } from 'vite'

import {
  assertSafeBuildOutputDirectory,
  assertSafeClientBuildEnvironment,
  completeManagedBuildOutput,
  createSupabaseBuildDefines,
  isServerArtifactSourcePath,
  type BuildOptions,
  type BuildResult
} from '../build'
import type { CompilerOutput } from '../types'
import {
  inMemoryVFS,
  prepareVfsRoot,
  VITE_JSX_ESBUILD,
  contentTypeForPath,
  type PreviewFiles,
  type WebVfsTarget
} from '../vfs'
import {
  OPENPENCIL_MICROFRONTEND_MANIFEST_FILENAME,
  OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT,
  OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION,
  OPENPENCIL_MICROFRONTEND_ABI_V1
} from './constants'
import {
  microfrontendSha256Base64URL,
  parseOpenPencilMicrofrontendRuntimeManifest,
  serializeOpenPencilMicrofrontendRuntimeManifest
} from './manifest'
import type { OpenPencilMicrofrontendRuntimeManifestV1 } from './types'

export const OPENPENCIL_MICROFRONTEND_ENTRY_PATH = './assets/openpencil-microfrontend.js'
export const OPENPENCIL_MICROFRONTEND_STYLE_PATH = './assets/openpencil-microfrontend.css'

function outputAssetPath(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path
}

export interface MicrofrontendBuildOptions {
  /** Compiler-owned VFS and runtime identity emitted only for explicit packaging. */
  output: CompilerOutput
  outDir: string
  fsRoot?: string
  base?: string
  env?: BuildOptions['env']
}

export interface MicrofrontendBuildResult extends BuildResult {
  manifest: OpenPencilMicrofrontendRuntimeManifestV1
  manifestPath: string
  /** Digest/length of the exact canonical manifest bytes written to disk. */
  manifestDigest: string
  manifestByteLength: number
}

const PLACEHOLDER_SHA_256 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function preflightRuntimeManifest(
  descriptor: NonNullable<CompilerOutput['microfrontend']>
): OpenPencilMicrofrontendRuntimeManifestV1 {
  return parseOpenPencilMicrofrontendRuntimeManifest({
    format: OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT,
    schemaVersion: OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION,
    abi: OPENPENCIL_MICROFRONTEND_ABI_V1,
    app: descriptor.app,
    artifact: {
      entry: {
        path: OPENPENCIL_MICROFRONTEND_ENTRY_PATH,
        mediaType: 'text/javascript',
        byteLength: 1,
        digest: PLACEHOLDER_SHA_256
      },
      styles: []
    },
    routes: [...descriptor.routes]
  })
}

function microfrontendSourceEntry(target: WebVfsTarget): string {
  return target === 'vue' ? 'src/microfrontend.ts' : 'src/microfrontend.tsx'
}

function browserBuildFiles(files: PreviewFiles): PreviewFiles {
  const browserFiles: PreviewFiles = new Map()
  for (const [path, content] of files) {
    if (!isServerArtifactSourcePath(path)) browserFiles.set(path, content)
  }
  return browserFiles
}

function inlineBinaryCSSReferences(files: PreviewFiles): PreviewFiles {
  const rewritten = new Map(files)
  for (const [path, content] of files) {
    if (typeof content !== 'string' || !path.endsWith('.css')) continue
    let css = content
    for (const [assetPath, bytes] of files) {
      if (!(bytes instanceof Uint8Array)) continue
      const relative = `./assets/${assetPath.replace(/^src\/assets\//, '')}`
      const dataURL = `data:${contentTypeForPath(assetPath)};base64,${Buffer.from(bytes).toString('base64')}`
      css = css.replaceAll(relative, dataURL)
    }
    rewritten.set(path, css)
  }
  return rewritten
}

function assetMediaType(path: string): 'text/javascript' | 'text/css' {
  if (path.endsWith('.js')) return 'text/javascript'
  if (path.endsWith('.css')) return 'text/css'
  throw new TypeError(`Unsupported microfrontend runtime asset: ${path}`)
}

function runtimeAsset(outDir: string, path: string) {
  const bytes = new Uint8Array(readFileSync(join(outDir, outputAssetPath(path))))
  return {
    path,
    mediaType: assetMediaType(path),
    byteLength: bytes.byteLength,
    digest: microfrontendSha256Base64URL(bytes)
  }
}

function writeRuntimeManifest(
  outDir: string,
  manifest: OpenPencilMicrofrontendRuntimeManifestV1
): { digest: string; byteLength: number } {
  const destination = join(outDir, OPENPENCIL_MICROFRONTEND_MANIFEST_FILENAME)
  mkdirSync(dirname(destination), { recursive: true })
  const bytes = new TextEncoder().encode(serializeOpenPencilMicrofrontendRuntimeManifest(manifest))
  writeFileSync(destination, bytes)
  return { digest: microfrontendSha256Base64URL(bytes), byteLength: bytes.byteLength }
}

function listBrowserBuildFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) visit(join(directory, entry.name), path)
      else files.push(path)
    }
  }
  visit(root, '')
  return files.sort()
}

/** The runtime manifest is a complete allowlist, not merely metadata for a
 * subset of Rollup output. Reject any extra browser file before publishing it. */
export function assertExactMicrofrontendRuntimeAssets(outDir: string): void {
  const allowed = new Set([
    outputAssetPath(OPENPENCIL_MICROFRONTEND_ENTRY_PATH),
    outputAssetPath(OPENPENCIL_MICROFRONTEND_STYLE_PATH)
  ])
  const unexpected = listBrowserBuildFiles(outDir).filter((path) => !allowed.has(path))
  if (unexpected.length > 0) {
    throw new Error(`Microfrontend build emitted an unpinned browser sidecar: ${unexpected[0]}`)
  }
}

/**
 * Build an explicitly emitted React/Vue microfrontend entry as one directly
 * loadable ESM file plus at most one CSS file. Framework code and binary design
 * assets are intentionally self-contained; a composition host never needs an
 * npm install, import map, or unpinned sidecar to mount this artifact.
 */
export async function buildMicrofrontendProject(
  options: MicrofrontendBuildOptions
): Promise<MicrofrontendBuildResult> {
  const descriptor = options.output.microfrontend
  if (!descriptor) {
    throw new Error(
      'Compiler output is not packaged as a microfrontend; compile with packaging.kind "microfrontend" first.'
    )
  }
  const preflight = preflightRuntimeManifest(descriptor)
  const target = preflight.app.framework
  const sourceEntry = microfrontendSourceEntry(target)
  if (!options.output.files.has(sourceEntry)) {
    throw new Error(
      `Microfrontend compiler output is missing ${sourceEntry}; compile with packaging.kind "microfrontend" first.`
    )
  }

  assertSafeBuildOutputDirectory(options.outDir)
  assertSafeClientBuildEnvironment(options.env)

  const workspaceRoot = options.fsRoot ?? process.cwd()
  const { scanRoot, vfsPrefix } = prepareVfsRoot(workspaceRoot, target)
  const files = inlineBinaryCSSReferences(browserBuildFiles(options.output.files))
  const vfs = inMemoryVFS(
    { files, inlineBinaryAssets: true, inlineBinaryCSSAssets: true },
    vfsPrefix
  )
  const frameworkPlugins: PluginOption[] =
    target === 'vue' ? [vue() as PluginOption] : (react() as PluginOption[])

  await build({
    root: scanRoot,
    base: options.base ?? './',
    configFile: false,
    envFile: false,
    define: {
      ...createSupabaseBuildDefines(options.env),
      'process.env.NODE_ENV': JSON.stringify('production')
    },
    logLevel: 'warn',
    plugins: [vfs, ...frameworkPlugins, ...tailwindcss()],
    ...(target === 'react' ? { esbuild: { ...VITE_JSX_ESBUILD, jsxDev: false } } : {}),
    build: {
      outDir: options.outDir,
      emptyOutDir: true,
      cssCodeSplit: false,
      lib: {
        entry: vfsPrefix + sourceEntry,
        formats: ['es'],
        fileName: () => outputAssetPath(OPENPENCIL_MICROFRONTEND_ENTRY_PATH)
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: outputAssetPath(OPENPENCIL_MICROFRONTEND_ENTRY_PATH),
          assetFileNames: (asset) =>
            asset.names.some((name) => name.endsWith('.css'))
              ? outputAssetPath(OPENPENCIL_MICROFRONTEND_STYLE_PATH)
              : 'assets/[name]-[hash][extname]'
        }
      }
    }
  })

  assertExactMicrofrontendRuntimeAssets(options.outDir)
  const entry = runtimeAsset(options.outDir, OPENPENCIL_MICROFRONTEND_ENTRY_PATH)
  const stylePath = join(options.outDir, outputAssetPath(OPENPENCIL_MICROFRONTEND_STYLE_PATH))
  const styles = existsSync(stylePath)
    ? [runtimeAsset(options.outDir, OPENPENCIL_MICROFRONTEND_STYLE_PATH)]
    : []
  const manifest = parseOpenPencilMicrofrontendRuntimeManifest({
    format: OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT,
    schemaVersion: OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION,
    abi: OPENPENCIL_MICROFRONTEND_ABI_V1,
    app: {
      ...preflight.app,
      framework: target
    },
    artifact: { entry, styles },
    routes: [...preflight.routes]
  })
  const manifestArtifact = writeRuntimeManifest(options.outDir, manifest)

  const result = completeManagedBuildOutput(options.output.files, options.outDir)
  return {
    ...result,
    manifest,
    manifestPath: OPENPENCIL_MICROFRONTEND_MANIFEST_FILENAME,
    manifestDigest: manifestArtifact.digest,
    manifestByteLength: manifestArtifact.byteLength
  }
}
