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
// / VERCEL_TOKEN) — never as a CLI arg (stays out of any process/arg listing)
// and never persisted.

import { ref, type Ref } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { decodeTauriStderr } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'

const DEPLOY_COMMAND = 'lowcode-preview' // shell-allowlisted `bun` (args:true)
const CLI_ENTRY = 'packages/cli/src/index.ts'

export type DeployProvider = 'netlify' | 'vercel'
// Phase 3 §15: optional code UI kit for the emitted project. 'none' → the
// self-contained Tailwind emit (default); 'shadcn' → `--ui-kit shadcn`.
export type DeployUiKit = 'none' | 'shadcn'
// The CLI reads the token from the matching env var (never an arg / never persisted).
const TOKEN_ENV: Record<DeployProvider, string> = { netlify: 'NETLIFY_AUTH_TOKEN', vercel: 'VERCEL_TOKEN' }

interface DeployCliResult {
  provider: string
  url: string
  deployId: string
  fileCount: number
}

export type DeployStatus =
  | { kind: 'idle' }
  | { kind: 'deploying' }
  | { kind: 'done'; url: string }
  | { kind: 'error'; message: string }

interface UseDeployResult {
  status: Ref<DeployStatus>
  /** Build + deploy the current document to `provider` with `token`. No-op
   *  while already deploying or outside Tauri. `uiKit` (§15) selects the emitted
   *  project's code UI kit ('none' → plain Tailwind, the default). */
  deploy: (
    token: string,
    provider: DeployProvider,
    site?: string,
    uiKit?: DeployUiKit
  ) => Promise<void>
  reset: () => void
}

export function useDeploy(): UseDeployResult {
  const status = ref<DeployStatus>({ kind: 'idle' })
  const store = useEditorStore()

  function reset(): void {
    status.value = { kind: 'idle' }
  }

  async function deploy(
    token: string,
    provider: DeployProvider,
    site?: string,
    uiKit: DeployUiKit = 'none'
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
      status.value = { kind: 'error', message: 'Save the document to a .fig file first, then deploy.' }
      return
    }

    status.value = { kind: 'deploying' }
    try {
      const result = await runDeployCli(path, trimmed, provider, site, uiKit)
      status.value = { kind: 'done', url: result.url }
    } catch (e) {
      status.value = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }

  return { status, deploy, reset }
}

async function runDeployCli(
  filePath: string,
  token: string,
  provider: DeployProvider,
  site?: string,
  uiKit: DeployUiKit = 'none'
): Promise<DeployCliResult> {
  const { Command } = await import('@tauri-apps/plugin-shell')
  const projectRoot: string = __OPENPENCIL_PROJECT_ROOT__
  const args = [CLI_ENTRY, 'deploy', filePath, '--provider', provider, '--json']
  if (site) args.push('--site', site)
  // Phase 3 §15: opt into a code UI kit for the emitted project.
  if (uiKit !== 'none') args.push('--ui-kit', uiKit)

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
