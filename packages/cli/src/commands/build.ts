import { resolve } from 'node:path'

import { defineCommand } from 'citty'

import { buildPreviewProject } from '@open-pencil/compiler/build'
import type { BuildResult } from '@open-pencil/compiler/build'

import { loadAndCompile, reportCodegenResult, resolveBuildEnv } from '#cli/codegen'
import { printError } from '#cli/format'
import { i18nArgs, resolveI18nFlags } from '#cli/i18n-args'
import { resolveUiKitFlag, uiKitArgs } from '#cli/ui-kit-args'

interface BuildArgs {
  file?: string
  out: string
  'package-name'?: string
  page?: string
  base?: string
  'supabase-url'?: string
  'supabase-anon-key'?: string
  i18n?: boolean
  locale?: string | string[]
  'source-locale'?: string
  'ui-kit'?: string
  json?: boolean
}

export default defineCommand({
  meta: {
    description: 'Build a .pen document into a deployable static SPA bundle (Vite + React)'
  },
  args: {
    file: {
      type: 'positional',
      description: 'Path to a .pen / .fig document',
      required: true
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Output directory for the static bundle (default: ./dist)',
      default: 'dist'
    },
    'package-name': {
      type: 'string',
      description: 'package.json name (default: sanitized from input file basename)',
      required: false
    },
    page: {
      type: 'string',
      description:
        'Restrict output to a single page by name. Default: all pages built (multi-page projects use react-router-dom — host with an SPA fallback).',
      required: false
    },
    base: {
      type: 'string',
      description: 'Public base path for assets (default: /). Set e.g. /app/ for sub-path hosting.',
      required: false
    },
    'supabase-url': {
      type: 'string',
      description: 'Override the Supabase URL for this build (else VITE_SUPABASE_URL, else design-time).',
      required: false
    },
    'supabase-anon-key': {
      type: 'string',
      description: 'Override the Supabase anon key for this build (else VITE_SUPABASE_ANON_KEY, else design-time).',
      required: false
    },
    ...i18nArgs,
    ...uiKitArgs,
    json: { type: 'boolean', description: 'Output a JSON summary instead of human-friendly text' }
  },
  async run({ args }) {
    const { file, out, page, base } = args as BuildArgs
    const outDir = resolve(out)
    const { i18n, locales, sourceLocale } = resolveI18nFlags(args as BuildArgs)
    const uiKit = resolveUiKitFlag(args as BuildArgs)

    const { compiled, packageName } = await loadAndCompile({
      file,
      page,
      packageName: (args as BuildArgs)['package-name'],
      outDir,
      json: args.json,
      i18n,
      locales,
      sourceLocale,
      uiKit
    })

    const env = resolveBuildEnv({
      supabaseUrl: (args as BuildArgs)['supabase-url'],
      supabaseAnonKey: (args as BuildArgs)['supabase-anon-key']
    })

    let result: BuildResult
    try {
      result = await buildPreviewProject({ files: compiled.files, outDir, base, env })
    } catch (e) {
      // Surface the Vite/build failure rather than swallowing it (经验 C).
      printError(e)
      process.exit(1)
    }

    reportCodegenResult({
      json: args.json,
      outDir,
      packageName,
      files: result.files,
      warnings: compiled.warnings,
      verb: 'Built',
      nextLine: `Done. Deploy ${outDir} to any static host (multi-page apps need an SPA fallback to index.html).`
    })
  }
})
