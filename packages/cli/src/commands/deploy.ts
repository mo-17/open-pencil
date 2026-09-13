import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { defineCommand } from 'citty'

import {
  buildPreviewProject,
  type BuildOptions,
  type BuildResult
} from '@open-pencil/compiler/build'
import { deployFiles, type DeployProgress, type DeployResult } from '@open-pencil/compiler/deploy'
import {
  resolveDeployEnvironment,
  type DeployEnvironment
} from '@open-pencil/core/lowcode-deployment'
import {
  auditApplicationRuntime,
  resolveApplicationRuntimeSupabaseConfig,
  type ApplicationRuntimeAudit,
  type ApplicationRuntimeGraph
} from '@open-pencil/lowcode/application-runtime'

import { hasCLIBackendProviderDeclaration } from '#cli/backend-provider-document'
import { BackendProviderInput, backendProviderDispatchDigest } from '#cli/backend-provider-input'
import { loadAndCompile, resolveBuildEnv } from '#cli/codegen'
import { codegenTargetArgs, resolveCodegenTarget } from '#cli/codegen-target'
import { withCompilerBuildRoot } from '#cli/compiler-build-root'
import { bold, dim, ok, printError } from '#cli/format'
import { i18nArgs, resolveI18nFlags } from '#cli/i18n-args'
import {
  createDeployServerDeploymentNotice,
  printManualServerDeploymentNotice
} from '#cli/server-deployment'
import { resolveUIKitFlag, uiKitArgs } from '#cli/ui-kit-args'

interface DeployArgs {
  file?: string
  provider?: string
  environment?: string
  token?: string
  site?: string
  'account-id'?: string
  page?: string
  base?: string
  'supabase-url'?: string
  'supabase-publishable-key'?: string
  'supabase-anon-key'?: string
  'supabase-schema'?: string
  'ui-kit'?: string
  i18n?: boolean
  locale?: string | string[]
  'source-locale'?: string
  json?: boolean
  target?: string
  'backend-provider-stdin'?: boolean
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

export interface DirectDeployBackendState {
  readonly audit: ApplicationRuntimeAudit
  readonly backendProviderDeclared: boolean
  readonly backendDeploymentRequired: boolean
  readonly status: 'frontend-deployed' | 'succeeded'
}

/**
 * Resolve application completion independently from emitted server files.
 * A Host-owned, data-only Backend Provider request may intentionally emit no
 * executable server bundle in the direct CLI, but still requires a separately
 * reviewed and verified Backend release before the application is Live.
 */
export function resolveDirectDeployBackendState(
  graph: ApplicationRuntimeGraph,
  options: {
    readonly environment: DeployEnvironment
    readonly serverFiles: readonly string[]
    readonly env?: BuildOptions['env']
  }
): DirectDeployBackendState {
  const backendProviderDeclared = hasCLIBackendProviderDeclaration(graph)
  const audit = auditApplicationRuntime(graph, {
    environment: options.environment,
    effectiveSupabaseConfig: resolveApplicationRuntimeSupabaseConfig(graph, {
      url: options.env?.VITE_SUPABASE_URL,
      anonKey: options.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? options.env?.VITE_SUPABASE_ANON_KEY,
      schema: options.env?.VITE_SUPABASE_SCHEMA
    }),
    backendProviderDeclared
  })
  const backendDeploymentRequired =
    audit.backendDeploymentRequired || options.serverFiles.length > 0
  return Object.freeze({
    audit,
    backendProviderDeclared,
    backendDeploymentRequired,
    status: backendDeploymentRequired ? 'frontend-deployed' : 'succeeded'
  })
}

export function resolveDeployProvider(raw: string | undefined): DeployProvider {
  const provider = (raw ?? 'netlify').toLowerCase()
  if ((PROVIDERS as readonly string[]).includes(provider)) return provider as DeployProvider
  throw new Error(`Unknown --provider '${provider}'. Supported: ${PROVIDERS.join(', ')}.`)
}

export function resolveCloudflareAccountId(
  explicit: string | undefined,
  environment: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (explicit !== undefined) return explicit.trim() || undefined
  if (environment.OPENPENCIL_DEPLOY_IGNORE_AMBIENT_TARGET === '1') return undefined
  return environment.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined
}

/** Read only the browser-static build paths into the provider upload payload. */
export function readStaticDist(
  result: Pick<BuildResult, 'outDir' | 'staticFiles'>
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  for (const rel of result.staticFiles) {
    files.set(rel, new Uint8Array(readFileSync(join(result.outDir, rel))))
  }
  return files
}

function logProgress(p: DeployProgress, provider: string): void {
  if (p.stage === 'upload' && p.done === 0) console.log(dim(`  Uploading to ${provider}…`))
  else if (p.stage === 'done') console.log('  Finalizing…')
}

function deployProgress(json: boolean | undefined, provider: string) {
  return json ? undefined : (progress: DeployProgress) => logProgress(progress, provider)
}

function deployServerNotice(built: BuildResult, file: string | undefined, hostReviewed: boolean) {
  // App declarations need Host-reviewed export; a raw CLI build recipe would fail closed.
  if (hostReviewed || !file || built.serverFiles.length === 0) return undefined
  return createDeployServerDeploymentNotice(file, resolve('openpencil-build'), built)
}

interface DeployReport {
  readonly result: DeployResult
  readonly environment: DeployEnvironment
  readonly target: string
  readonly backendDeploymentRequired: boolean
  readonly serverDeployment: ReturnType<typeof deployServerNotice>
  readonly json: boolean | undefined
}

function reportDeployResult(report: DeployReport): void {
  const { result, environment, target, backendDeploymentRequired, serverDeployment } = report
  if (report.json) {
    console.log(
      JSON.stringify(
        {
          ...result,
          environment,
          target,
          status: backendDeploymentRequired ? 'frontend-deployed' : 'succeeded',
          backendDeploymentRequired,
          serverDeployment
        },
        null,
        2
      )
    )
    return
  }
  console.log('')
  console.log(bold(`  Deployed ${result.fileCount} files to ${result.provider} (${environment})`))
  console.log('')
  console.log(ok(`${backendDeploymentRequired ? 'Frontend live' : 'Live'} at ${result.url}`))
  if (serverDeployment) printManualServerDeploymentNotice(serverDeployment)
  else if (backendDeploymentRequired) {
    console.log(
      dim(
        '  Backend deployment remains required; static hosting did not verify or apply Backend state.'
      )
    )
  }
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
    environment: {
      type: 'string',
      description:
        'Deployment environment: preview (default), staging, or production. Selects runtime preflight rules and labels the result; provider targeting still comes from --site / provider settings.',
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
      description: 'Restrict to one page. Default: all pages (multi-page uses the target router).',
      required: false
    },
    ...codegenTargetArgs,
    'backend-provider-stdin': {
      type: 'boolean',
      description:
        'Receive an explicit bounded Backend Provider request and fresh upload authorization over stdin. Requires --json and a saved matching document declaration.'
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
    'supabase-publishable-key': {
      type: 'string',
      description:
        'Override the Supabase publishable key for this deploy (else VITE_SUPABASE_PUBLISHABLE_KEY, else legacy anon/design-time).',
      required: false
    },
    'supabase-anon-key': {
      type: 'string',
      description:
        'Legacy alias for --supabase-publishable-key (also reads VITE_SUPABASE_ANON_KEY).',
      required: false
    },
    'supabase-schema': {
      type: 'string',
      description:
        'Override the Supabase schema for this deploy (else VITE_SUPABASE_SCHEMA, else design-time/public).',
      required: false
    },
    ...uiKitArgs,
    ...i18nArgs,
    json: { type: 'boolean', description: 'Output a JSON summary instead of human-friendly text' }
  },
  async run({ args }) {
    const { file, page, base } = args as DeployArgs
    const uiKit = resolveUIKitFlag(args as DeployArgs)
    const target = resolveCodegenTarget(args as DeployArgs)
    const { i18n, locales, sourceLocale } = resolveI18nFlags(args as DeployArgs)
    let provider: DeployProvider
    try {
      provider = resolveDeployProvider((args as DeployArgs).provider)
    } catch (e) {
      printError(e)
      process.exit(1)
    }
    const deployArgs = args as DeployArgs
    if (deployArgs['backend-provider-stdin'] && !args.json) {
      printError('Backend Provider stdin handoff requires --json.')
      process.exitCode = 1
      return
    }
    let environment: DeployEnvironment
    try {
      environment = resolveDeployEnvironment(deployArgs.environment)
    } catch (e) {
      printError(e)
      process.exit(1)
    }
    const token = deployArgs.token ?? process.env[TOKEN_ENV[provider]]
    if (!token) {
      printError(
        `A ${provider} token is required. Pass --token <token> or set ${TOKEN_ENV[provider]}.\n` +
          `Create one at ${TOKEN_HELP[provider]}`
      )
      process.exit(1)
    }

    const buildDir = mkdtempSync(join(tmpdir(), 'op-deploy-'))
    const backendInput = deployArgs['backend-provider-stdin']
      ? new BackendProviderInput()
      : undefined
    try {
      let backendProviderHandoff
      try {
        backendProviderHandoff = await backendInput?.readRequest()
      } catch (error) {
        printError(error)
        process.exitCode = 1
        return
      }
      const compilation = await loadAndCompile({
        file,
        page,
        outDir: buildDir,
        json: args.json,
        uiKit,
        i18n,
        locales,
        sourceLocale,
        target,
        backendProviderHandoff
      })

      if (!compilation) {
        process.exitCode = 1
        return
      }
      const { compiled, graph } = compilation

      let env: ReturnType<typeof resolveBuildEnv>
      try {
        env = resolveBuildEnv({
          supabaseUrl: (args as DeployArgs)['supabase-url'],
          supabasePublishableKey: (args as DeployArgs)['supabase-publishable-key'],
          supabaseAnonKey: (args as DeployArgs)['supabase-anon-key'],
          supabaseSchema: (args as DeployArgs)['supabase-schema']
        })
      } catch (e) {
        printError(e)
        process.exitCode = 1
        return
      }

      const backendState = resolveDirectDeployBackendState(graph, {
        environment,
        serverFiles: [],
        env
      })
      if (!backendState.audit.ready) {
        printError(
          backendState.audit.issues
            .filter((issue) => issue.severity === 'error')
            .map((issue) => `[${issue.code}] ${issue.message}`)
            .join(' ')
        )
        process.exitCode = 1
        return
      }

      if (!args.json) console.log('  Building…')
      const built = await withCompilerBuildRoot((fsRoot) =>
        buildPreviewProject({
          files: compiled.files,
          artifactOwnership: compiled.artifactOwnership,
          outDir: buildDir,
          base,
          env,
          target,
          fsRoot
        })
      )
      // `openpencil-server/` is an operator-owned Edge Function bundle. Static
      // providers receive browser assets only; this command never deploys the
      // function or configures its secrets as a side effect.
      const dist = readStaticDist(built)
      const backendDeploymentRequired =
        backendState.backendDeploymentRequired || built.serverFiles.length > 0
      const serverDeployment = deployServerNotice(built, file, Boolean(backendProviderHandoff))

      const accountId =
        provider === 'cloudflare' ? resolveCloudflareAccountId(deployArgs['account-id']) : undefined
      if (backendInput) {
        try {
          await backendInput.authorizeUpload(
            backendProviderDispatchDigest(
              dist,
              JSON.stringify({
                provider,
                environment,
                target,
                site: deployArgs.site,
                accountId,
                base,
                env
              })
            )
          )
        } catch (error) {
          printError(error)
          process.exitCode = 1
          return
        }
      }

      let result: DeployResult
      try {
        result = await deployFiles(
          dist,
          {
            provider,
            token,
            site: deployArgs.site,
            accountId
          },
          { onProgress: deployProgress(args.json, provider) }
        )
      } catch (e) {
        // Surface the deploy/API failure rather than swallowing it (经验 C).
        printError(e)
        process.exitCode = 1
        return
      }

      reportDeployResult({
        result,
        environment,
        target,
        backendDeploymentRequired,
        serverDeployment,
        json: args.json
      })
    } finally {
      backendInput?.dispose()
      rmSync(buildDir, { recursive: true, force: true })
    }
  }
})
