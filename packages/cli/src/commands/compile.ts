import { resolve } from 'node:path'

import { defineCommand } from 'citty'

import { loadAndCompile, reportCodegenResult } from '#cli/codegen'
import { i18nArgs, resolveI18nFlags } from '#cli/i18n-args'

interface CompileArgs {
  file?: string
  out: string
  'package-name'?: string
  page?: string
  i18n?: boolean
  locale?: string | string[]
  'source-locale'?: string
  json?: boolean
}

async function writeFiles(
  outDir: string,
  files: Map<string, string | Uint8Array>
): Promise<string[]> {
  const written: string[] = []
  for (const [rel, content] of files) {
    const dest = resolve(outDir, rel)
    await Bun.write(dest, content)
    written.push(rel)
  }
  return written.sort()
}

export default defineCommand({
  meta: {
    description: 'Compile a .pen document into a runnable Vite + React + TS project'
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
      description: 'Output directory (default: .)',
      default: '.'
    },
    'package-name': {
      type: 'string',
      description: 'package.json name (default: sanitized from input file basename)',
      required: false
    },
    page: {
      type: 'string',
      description:
        'Restrict output to a single page by name. Default: all pages compiled (multi-page projects use react-router-dom).',
      required: false
    },
    ...i18nArgs,
    json: { type: 'boolean', description: 'Output a JSON summary instead of human-friendly text' }
  },
  async run({ args }) {
    const { file, out, page } = args as CompileArgs
    const outDir = resolve(out)
    const { i18n, locales, sourceLocale } = resolveI18nFlags(args as CompileArgs)

    const { compiled, packageName } = await loadAndCompile({
      file,
      page,
      packageName: (args as CompileArgs)['package-name'],
      outDir,
      json: args.json,
      i18n,
      locales,
      sourceLocale
    })

    const written = await writeFiles(outDir, compiled.files)

    reportCodegenResult({
      json: args.json,
      outDir,
      packageName,
      files: written,
      warnings: compiled.warnings,
      verb: 'Compiled',
      nextLine: `Done. Next: cd ${outDir} && npm install && npm run dev`
    })
  }
})
