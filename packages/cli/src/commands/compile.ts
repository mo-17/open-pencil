import { resolve } from 'node:path'

import { defineCommand } from 'citty'

import { loadAndCompile, reportCodegenResult } from '#cli/codegen'
import { codegenTargetArgs, resolveCodegenTarget } from '#cli/codegen-target'
import { printError } from '#cli/format'
import { i18nArgs, resolveI18nFlags } from '#cli/i18n-args'
import { microfrontendPackagingArgs, resolveMicrofrontendPackaging } from '#cli/microfrontend-args'
import { resolveUIKitFlag, uiKitArgs } from '#cli/ui-kit-args'

interface CompileArgs {
  file?: string
  out: string
  'package-name'?: string
  page?: string
  i18n?: boolean
  locale?: string | string[]
  'source-locale'?: string
  'ui-kit'?: string
  json?: boolean
  target?: string
  packaging?: string
  'app-id'?: string
  'app-version'?: string
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
    description: 'Compile a .pen document into a runnable Vite + React or Vue 3 + TS project'
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
        'Restrict output to one page. Default: all pages (multi-page output uses the target router).',
      required: false
    },
    ...codegenTargetArgs,
    ...i18nArgs,
    ...uiKitArgs,
    ...microfrontendPackagingArgs,
    json: { type: 'boolean', description: 'Output a JSON summary instead of human-friendly text' }
  },
  async run({ args }) {
    const { file, out, page } = args as CompileArgs
    const outDir = resolve(out)
    const { i18n, locales, sourceLocale } = resolveI18nFlags(args as CompileArgs)
    const uiKit = resolveUIKitFlag(args as CompileArgs)
    const target = resolveCodegenTarget(args as CompileArgs)
    let packaging
    try {
      packaging = resolveMicrofrontendPackaging(args as CompileArgs)
    } catch (error) {
      printError(error)
      process.exit(1)
    }

    const { compiled, packageName } = await loadAndCompile({
      file,
      page,
      packageName: (args as CompileArgs)['package-name'],
      outDir,
      json: args.json,
      i18n,
      locales,
      sourceLocale,
      uiKit,
      target,
      packaging
    })

    const written = await writeFiles(outDir, compiled.files)

    reportCodegenResult({
      json: args.json,
      outDir,
      packageName,
      files: written,
      warnings: compiled.warnings,
      verb: 'Compiled',
      nextLine: `Done. Next: cd ${outDir} && npm install && npm run dev`,
      target
    })
  }
})
