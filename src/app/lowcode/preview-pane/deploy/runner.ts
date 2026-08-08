import { decodeTauriStderr } from '@/app/shell/ui'

import { buildDeployProcessEnv, parseDeployCliResult, type DeployCliResult } from './command'
import type { DeployEnvironment, DeployRuntimeConfig } from './history'

const DEPLOY_COMMAND = 'lowcode-preview'
const CLI_ENTRY = 'packages/cli/src/index.ts'

export type DeployProvider = 'netlify' | 'vercel' | 'cloudflare'
export type DeployUiKit = 'none' | 'shadcn'

export interface DeployI18n {
  enabled: boolean
  locales: string[]
}

export async function runDeployCli(
  filePath: string,
  token: string,
  provider: DeployProvider,
  environment: DeployEnvironment,
  site?: string,
  uiKit: DeployUiKit = 'none',
  i18n?: DeployI18n,
  runtimeConfig?: DeployRuntimeConfig
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
  if (uiKit !== 'none') args.push('--ui-kit', uiKit)
  if (i18n?.enabled) {
    args.push('--i18n')
    for (const locale of i18n.locales) args.push('--locale', locale)
  }

  const command = Command.create(DEPLOY_COMMAND, args, {
    cwd: projectRoot,
    env: buildDeployProcessEnv(provider, token, runtimeConfig)
  })
  let stdout = ''
  const stderrTail: string[] = []
  command.stdout.on('data', (raw: Uint8Array | number[] | string) => {
    stdout += typeof raw === 'string' ? raw : decodeTauriStderr(raw)
  })
  command.stderr.on('data', (raw: Uint8Array | number[] | string) => {
    stderrTail.push(decodeTauriStderr(raw))
  })

  return new Promise<DeployCliResult>((resolve, reject) => {
    command.on('close', (data: { code: number | null }) => {
      if (data.code !== 0) {
        const detail = stderrTail.join('').trim()
        reject(new Error(detail || `Deploy failed (exit code ${data.code ?? 'null'}).`))
        return
      }
      try {
        resolve(parseDeployCliResult(stdout.trim()))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    command.on('error', (error: string) => reject(new Error(error)))
    void command.spawn().catch((error: unknown) => {
      const hint =
        'Failed to spawn `bun`. Ensure bun is on the launching shell PATH ' +
        '(GUI apps on macOS may need `~/.bun/bin` exported in /etc/paths.d or via launchctl).'
      reject(new Error(`${error instanceof Error ? error.message : String(error)} — ${hint}`))
    })
  })
}
