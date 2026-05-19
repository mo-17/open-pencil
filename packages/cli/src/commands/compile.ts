import { basename, extname, resolve } from 'node:path'

import { defineCommand } from 'citty'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { CompileWarning, CompilerOutput } from '@open-pencil/compiler'

import { bold, fmtList, ok, printError } from '#cli/format'
import { loadDocument } from '#cli/headless'

interface CompileArgs {
  file?: string
  out: string
  'package-name'?: string
  page?: string
  json?: boolean
}

function sanitizePackageName(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  return slug || 'openpencil-output'
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

function formatWarning(w: CompileWarning): string {
  const id = w.nodeId ? ` (node ${w.nodeId})` : ''
  return `[${w.code}] ${w.message}${id}`
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
      description: 'Page to compile by name (default: first page)',
      required: false
    },
    json: { type: 'boolean', description: 'Output a JSON summary instead of human-friendly text' }
  },
  async run({ args }) {
    const { file, out, page } = args as CompileArgs
    if (!file) {
      printError('A document file path is required.')
      process.exit(1)
    }

    const graph = await loadDocument(file)
    const pages = graph.getPages()
    if (pages.length === 0) {
      printError('Document has no pages.')
      process.exit(1)
    }

    const target = page ? pages.find((p) => p.name === page) : pages[0]
    if (!target) {
      const available = pages.map((p) => `"${p.name}"`).join(', ')
      printError(`Page "${page}" not found. Available pages: ${available || 'none'}.`)
      process.exit(1)
    }

    const packageName = sanitizePackageName(
      (args as CompileArgs)['package-name'] ?? basename(file, extname(file))
    )
    const outDir = resolve(out)

    let result: CompilerOutput
    try {
      result = compile({
        graph,
        pageIds: [target.id],
        options: withDefaults({ packageName })
      })
    } catch (e) {
      printError(e)
      process.exit(1)
    }

    if (result.files.size === 0) {
      const codes = result.warnings.map((w) => w.code).join(', ')
      printError(
        `Compile produced no files${codes ? ` (warnings: ${codes})` : ''}. ` +
          'Aborting before touching the output directory.'
      )
      if (args.json) {
        console.log(
          JSON.stringify({ outDir, files: [], warnings: result.warnings, packageName }, null, 2)
        )
      }
      process.exit(1)
    }

    const written = await writeFiles(outDir, result.files)

    if (args.json) {
      console.log(
        JSON.stringify({ outDir, packageName, files: written, warnings: result.warnings }, null, 2)
      )
      return
    }

    console.log('')
    console.log(bold(`  Compiled ${written.length} files into ${outDir}`))
    console.log('')
    console.log(fmtList(written.map((rel) => ({ header: rel }))))

    if (result.warnings.length > 0) {
      console.log('')
      console.log(bold(`  ${result.warnings.length} warning(s):`))
      console.log('')
      console.log(fmtList(result.warnings.map((w) => ({ header: formatWarning(w) }))))
    }

    console.log('')
    console.log(ok(`Done. Next: cd ${outDir} && npm install && npm run dev`))
  }
})
