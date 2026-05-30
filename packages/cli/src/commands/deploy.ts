import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { defineCommand } from 'citty'

import { buildPreviewProject } from '@open-pencil/compiler/build'
import { deployFiles, type DeployProgress, type DeployResult } from '@open-pencil/compiler/deploy'

import { loadAndCompile, resolveBuildEnv } from '#cli/codegen'
import { bold, ok, printError } from '#cli/format'

interface DeployArgs {
  file?: string
  token?: string
  site?: string
  page?: string
  base?: string
  'supabase-url'?: string
  'supabase-anon-key'?: string
  json?: boolean
}

/** Read a built dist directory back into a path → bytes map for upload. */
function readDist(outDir: string, relPaths: readonly string[]): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  for (const rel of relPaths) {
    files.set(rel, new Uint8Array(readFileSync(join(outDir, rel))))
  }
  return files
}

function logProgress(p: DeployProgress): void {
  if (p.stage === 'create') console.log('  Uploading to Netlify…')
  else if (p.stage === 'done') console.log('  Finalizing…')
}

export default defineCommand({
  meta: {
    description: 'Build a .pen document and deploy it to Netlify (static SPA hosting)'
  },
  args: {
    file: {
      type: 'positional',
      description: 'Path to a .pen / .fig document',
      required: true
    },
    token: {
      type: 'string',
      description: 'Netlify personal access token (falls back to NETLIFY_AUTH_TOKEN)',
      required: false
    },
    site: {
      type: 'string',
      description: 'Existing Netlify site id or *.netlify.app subdomain (default: create a new site)',
      required: false
    },
    page: {
      type: 'string',
      description: 'Restrict to a single page by name. Default: all pages (multi-page uses react-router-dom).',
      required: false
    },
    base: {
      type: 'string',
      description: 'Public base path for assets (default: /).',
      required: false
    },
    'supabase-url': {
      type: 'string',
      description: 'Override the Supabase URL for this deploy (else VITE_SUPABASE_URL, else design-time).',
      required: false
    },
    'supabase-anon-key': {
      type: 'string',
      description: 'Override the Supabase anon key for this deploy (else VITE_SUPABASE_ANON_KEY, else design-time).',
      required: false
    },
    json: { type: 'boolean', description: 'Output a JSON summary instead of human-friendly text' }
  },
  async run({ args }) {
    const { file, page, base } = args as DeployArgs
    const token = (args as DeployArgs).token ?? process.env.NETLIFY_AUTH_TOKEN
    if (!token) {
      printError(
        'A Netlify token is required. Pass --token <token> or set NETLIFY_AUTH_TOKEN.\n' +
          'Create one at https://app.netlify.com/user/applications#personal-access-tokens'
      )
      process.exit(1)
    }

    const buildDir = mkdtempSync(join(tmpdir(), 'op-deploy-'))
    try {
      const { compiled } = await loadAndCompile({
        file,
        page,
        outDir: buildDir,
        json: args.json
      })

      const env = resolveBuildEnv({
        supabaseUrl: (args as DeployArgs)['supabase-url'],
        supabaseAnonKey: (args as DeployArgs)['supabase-anon-key']
      })

      if (!args.json) console.log('  Building…')
      const built = await buildPreviewProject({ files: compiled.files, outDir: buildDir, base, env })
      const dist = readDist(built.outDir, built.files)

      let result: DeployResult
      try {
        result = await deployFiles(
          dist,
          { provider: 'netlify', token, site: (args as DeployArgs).site },
          { onProgress: args.json ? undefined : logProgress }
        )
      } catch (e) {
        // Surface the deploy/API failure rather than swallowing it (经验 C).
        printError(e)
        process.exit(1)
      }

      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      console.log('')
      console.log(bold(`  Deployed ${result.fileCount} files to ${result.provider}`))
      console.log('')
      console.log(ok(`Live at ${result.url}`))
    } finally {
      rmSync(buildDir, { recursive: true, force: true })
    }
  }
})
