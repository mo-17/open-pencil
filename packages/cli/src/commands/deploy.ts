import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { defineCommand } from 'citty'

import { buildPreviewProject } from '@open-pencil/compiler/build'
import { deployFiles, type DeployProgress, type DeployResult } from '@open-pencil/compiler/deploy'

import { loadAndCompile, resolveBuildEnv } from '#cli/codegen'
import { bold, dim, ok, printError } from '#cli/format'
import { i18nArgs, resolveI18nFlags } from '#cli/i18n-args'
import { resolveUiKitFlag, uiKitArgs } from '#cli/ui-kit-args'

interface DeployArgs {
  file?: string
  provider?: string
  token?: string
  site?: string
  'account-id'?: string
  page?: string
  base?: string
  'supabase-url'?: string
  'supabase-anon-key'?: string
  'ui-kit'?: string
  i18n?: boolean
  locale?: string | string[]
  'source-locale'?: string
  json?: boolean
}

const PROVIDERS = ['netlify', 'vercel', 'cloudflare'] as const
type DeployProvider = (typeof PROVIDERS)[number]
const TOKEN_ENV: Record<DeployProvider, string> = {
  netlify: 'NETLIFY_AUTH_TOKEN',
  vercel: 'VERCEL_TOKEN',
  cloudflare: 'CLOUDFLARE_API_TOKEN'
}
const TOKEN_HELP: Record<DeployProvider, string> = {
  netlify: 'https://app.netlify.com/user/applications#personal-access-tokens',
  vercel: 'https://vercel.com/account/tokens',
  cloudflare: 'https://dash.cloudflare.com/profile/api-tokens'
}

/** Read a built dist directory back into a path → bytes map for upload. */
function readDist(outDir: string, relPaths: readonly string[]): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  for (const rel of relPaths) {
    files.set(rel, new Uint8Array(readFileSync(join(outDir, rel))))
  }
  return files
}

function logProgress(p: DeployProgress, provider: string): void {
  if (p.stage === 'upload' && p.done === 0) console.log(dim(`  Uploading to ${provider}…`))
  else if (p.stage === 'done') console.log('  Finalizing…')
}

export default defineCommand({
  meta: {
    description:
      'Build a .pen document and deploy it to a static host (Netlify, Vercel, or Cloudflare Pages)'
  },
  args: {
    file: {
      type: 'positional',
      description: 'Path to a .pen / .fig document',
      required: true
    },
    provider: {
      type: 'string',
      description: 'Hosting provider: netlify (default), vercel, or cloudflare.',
      required: false
    },
    token: {
      type: 'string',
      description:
        'Provider access token (falls back to NETLIFY_AUTH_TOKEN / VERCEL_TOKEN / CLOUDFLARE_API_TOKEN).',
      required: false
    },
    site: {
      type: 'string',
      description:
        'Existing target — Netlify site id/subdomain, Vercel project name, or Cloudflare project name. For Cloudflare, use <account>/<project> or pass --account-id.',
      required: false
    },
    'account-id': {
      type: 'string',
      description:
        'Cloudflare account id. May also be set with CLOUDFLARE_ACCOUNT_ID, or encoded in --site <account>/<project>.',
      required: false
    },
    page: {
      type: 'string',
      description:
        'Restrict to a single page by name. Default: all pages (multi-page uses react-router-dom).',
      required: false
    },
    base: {
      type: 'string',
      description: 'Public base path for assets (default: /).',
      required: false
    },
    'supabase-url': {
      type: 'string',
      description:
        'Override the Supabase URL for this deploy (else VITE_SUPABASE_URL, else design-time).',
      required: false
    },
    'supabase-anon-key': {
      type: 'string',
      description:
        'Override the Supabase anon key for this deploy (else VITE_SUPABASE_ANON_KEY, else design-time).',
      required: false
    },
    ...uiKitArgs,
    ...i18nArgs,
    json: { type: 'boolean', description: 'Output a JSON summary instead of human-friendly text' }
  },
  async run({ args }) {
    const { file, page, base } = args as DeployArgs
    const uiKit = resolveUiKitFlag(args as DeployArgs)
    const { i18n, locales, sourceLocale } = resolveI18nFlags(args as DeployArgs)
    const providerArg = ((args as DeployArgs).provider ?? 'netlify').toLowerCase()
    if (providerArg !== 'netlify' && providerArg !== 'vercel') {
      printError(`Unknown --provider '${providerArg}'. Supported: ${PROVIDERS.join(', ')}.`)
      process.exit(1)
    }
    const provider: DeployProvider = providerArg
    const deployArgs = args as DeployArgs
    const token = deployArgs.token ?? process.env[TOKEN_ENV[provider]]
    if (!token) {
      printError(
        `A ${provider} token is required. Pass --token <token> or set ${TOKEN_ENV[provider]}.\n` +
          `Create one at ${TOKEN_HELP[provider]}`
      )
      process.exit(1)
    }

    const buildDir = mkdtempSync(join(tmpdir(), 'op-deploy-'))
    try {
      const { compiled } = await loadAndCompile({
        file,
        page,
        outDir: buildDir,
        json: args.json,
        uiKit,
        i18n,
        locales,
        sourceLocale
      })

      const env = resolveBuildEnv({
        supabaseUrl: (args as DeployArgs)['supabase-url'],
        supabaseAnonKey: (args as DeployArgs)['supabase-anon-key']
      })

      if (!args.json) console.log('  Building…')
      const built = await buildPreviewProject({
        files: compiled.files,
        outDir: buildDir,
        base,
        env
      })
      const dist = readDist(built.outDir, built.files)

      let result: DeployResult
      try {
        result = await deployFiles(
          dist,
          {
            provider,
            token,
            site: deployArgs.site,
            accountId:
              provider === 'cloudflare'
                ? (deployArgs['account-id'] ?? process.env.CLOUDFLARE_ACCOUNT_ID)
                : undefined
          },
          { onProgress: args.json ? undefined : (p) => logProgress(p, provider) }
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
