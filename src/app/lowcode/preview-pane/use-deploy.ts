// One-click deploy from the editor (Phase 3 §5, second slice — step 6).
//
// Keeps a single deploy pipeline (经验 A): instead of re-implementing the
// build + upload in the browser, this shells out to the very same
// `open-pencil deploy` CLI command over @tauri-apps/plugin-shell — the same
// pattern the preview dev-server sidecar uses (use-compile-on-change.ts). The
// CLI runs with `--json` so stdout is a single machine-readable result object.
//
// Tauri-only (needs a real `bun` + the repo on disk, like the preview sidecar).
// The provider token is passed via the spawned process's env (NETLIFY_AUTH_TOKEN
// / VERCEL_TOKEN / CLOUDFLARE_API_TOKEN) — never as a CLI arg (stays out of any
// process/arg listing) and never persisted.

import { ref, type Ref } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { decodeTauriStderr } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'

import {
  recordDeployHistory,
  readDeployHistory,
  type DeployEnvironment,
  type DeployHistoryEntry
} from './deploy-history'

const DEPLOY_COMMAND = 'lowcode-preview' // shell-allowlisted `bun` (args:true)
const CLI_ENTRY = 'packages/cli/src/index.ts'

export type DeployProvider = 'netlify' | 'vercel' | 'cloudflare'
// Phase 3 §15: optional code UI kit for the emitted project. 'none' → the
// self-contained Tailwind emit (default); 'shadcn' → `--ui-kit shadcn`.
export type DeployUiKit = 'none' | 'shadcn'
// Phase 3 §9: optional i18n for the emitted project. `enabled` → `--i18n`;
// `locales` → one `--locale <code>` each (target languages beyond the source).
export interface DeployI18n {
  enabled: boolean
  locales: string[]
}
// The CLI reads the token from the matching env var (never an arg / never persisted).
const TOKEN_ENV: Record<DeployProvider, string> = {
  netlify: 'NETLIFY_AUTH_TOKEN',
  vercel: 'VERCEL_TOKEN',
  cloudflare: 'CLOUDFLARE_API_TOKEN'
}

interface DeployCliResult {
  provider: string
  url: string
  deployId: string
  fileCount: number
  environment: DeployEnvironment
}

export type DeployStatus =
  | { kind: 'idle' }
  | { kind: 'deploying' }
  | { kind: 'done'; url: string; result: DeployCliResult }
  | { kind: 'error'; message: string }

interface UseDeployResult {
  status: Ref<DeployStatus>
  /** Build + deploy the current document to `provider` with `token`. No-op
   *  while already deploying or outside Tauri. `uiKit` (§15) selects the emitted
   *  project's code UI kit ('none' → plain Tailwind, the default); `i18n` (§9)
   *  enables the react-intl runtime + target-locale catalogs. */
  deploy: (
    token: string,
    provider: DeployProvider,
    environment: DeployEnvironment,
    site?: string,
    uiKit?: DeployUiKit,
    i18n?: DeployI18n
  ) => Promise<void>
  history: Ref<DeployHistoryEntry[]>
  reset: () => void
}

export function useDeploy(): UseDeployResult {
  const status = ref<DeployStatus>({ kind: 'idle' })
  const history = ref<DeployHistoryEntry[]>(readDeployHistory())
  const store = useEditorStore()

  function reset(): void {
    status.value = { kind: 'idle' }
  }

  async function deploy(
    token: string,
    provider: DeployProvider,
    environment: DeployEnvironment,
    site?: string,
    uiKit: DeployUiKit = 'none',
    i18n?: DeployI18n
  ): Promise<void> {
    if (status.value.kind === 'deploying') return
    if (!isTauri()) {
      status.value = { kind: 'error', message: 'Deploy is only available in the desktop app.' }
      return
    }
    const trimmed = token.trim()
    if (!trimmed) {
      status.value = { kind: 'error', message: `Enter a ${provider} token.` }
      return
    }
    const path = store.getDocumentPath()
    if (!path) {
      status.value = {
        kind: 'error',
        message: 'Save the document to a .fig file first, then deploy.'
      }
      return
    }

    status.value = { kind: 'deploying' }
    try {
      const result = await runDeployCli(path, trimmed, provider, environment, site, uiKit, i18n)
      history.value = recordDeployHistory({
        ...result,
        site,
        uiKit,
        i18nEnabled: i18n?.enabled ?? false,
        locales: i18n?.enabled ? i18n.locales : []
      })
      status.value = { kind: 'done', url: result.url, result }
    } catch (e) {
      status.value = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }

  return { status, deploy, history, reset }
}

async function runDeployCli(
  filePath: string,
  token: string,
  provider: DeployProvider,
  environment: DeployEnvironment,
  site?: string,
  uiKit: DeployUiKit = 'none',
  i18n?: DeployI18n
): Promise<DeployCliResult> {
  const { Command } = await import('@tauri-apps/plugin-shell')
  const projectRoot: string = __OPENPENCIL_PROJECT_ROOT__
  const args = [
    CLI_ENTRY,
    'deploy',
    filePath,
    '--provider',
    provider,
    '--environment',
    environment,
    '--json'
  ]
  if (site) args.push('--site', site)
  // Phase 3 §15: opt into a code UI kit for the emitted project.
  if (uiKit !== 'none') args.push('--ui-kit', uiKit)
  // Phase 3 §9: enable i18n + declare each target locale (the CLI implies
  // --i18n from any --locale, but pass it explicitly for the locale-less case).
  if (i18n?.enabled) {
    args.push('--i18n')
    for (const loc of i18n.locales) args.push('--locale', loc)
  }

  const command = Command.create(DEPLOY_COMMAND, args, {
    cwd: projectRoot,
    env: { [TOKEN_ENV[provider]]: token }
  })

  let stdout = ''
  const stderrTail: string[] = []
  command.stdout.on('data', (raw: Uint8Array | number[] | string) => {
    stdout += typeof raw === 'string' ? raw : decodeTauriStderr(raw)
  })
  command.stderr.on('data', (raw: Uint8Array | number[] | string) => {
    stderrTail.push(decodeTauriStderr(raw))
  })

  const child = await command.spawn().catch((e: unknown) => {
    const hint =
      'Failed to spawn `bun`. Ensure bun is on the launching shell PATH ' +
      '(GUI apps on macOS may need `~/.bun/bin` exported in /etc/paths.d or via launchctl).'
    throw new Error(`${e instanceof Error ? e.message : String(e)} — ${hint}`)
  })

  return new Promise<DeployCliResult>((resolve, reject) => {
    command.on('close', (data: { code: number | null }) => {
      if (data.code !== 0) {
        const detail = stderrTail.join('').trim()
        reject(new Error(detail || `Deploy failed (exit code ${data.code ?? 'null'}).`))
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()) as DeployCliResult)
      } catch {
        reject(new Error(`Could not parse deploy output:\n${stdout.trim() || '(empty)'}`))
      }
    })
    command.on('error', (err: string) => reject(new Error(err)))
    void child
  })
}
