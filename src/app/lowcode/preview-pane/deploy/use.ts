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

import type { ApplicationRuntimeAudit } from '@open-pencil/lowcode/application-runtime'

import { getActiveEditorStore } from '@/app/editor/active-store'
import { appPluginStore } from '@/app/plugins/app'
import {
  prepareAppBackendProviderDocumentBuild,
  type PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import { isTauri } from '@/app/tauri/env'

import type { DeployCLIResult } from './command'
import {
  recordDeployHistory,
  readDeployHistory,
  type DeployEnvironment,
  type DeployHistoryEntry,
  type DeployRuntimeConfig
} from './history'
import { runDeployCLI, type DeployI18n, type DeployProvider, type DeployUIKit } from './runner'
import { preflightDeployRuntime } from './runtime-preflight'
import { deployScopeForStore } from './scope'

export type { DeployI18n, DeployProvider, DeployUIKit } from './runner'
export const BACKEND_DEPLOYMENT_REQUIRED_NOTICE =
  'Static frontend deployment completed, but the backend deployment is not verified. Deploy and verify the backend before treating the application as complete.'

export type DeployCompletedStatus =
  | { kind: 'done'; url: string; result: DeployCLIResult }
  | {
      kind: 'frontend-deployed'
      url: string
      result: DeployCLIResult
      backendDeploymentRequired: true
      notice: string
    }

export type DeployStatus =
  | { kind: 'idle' }
  | { kind: 'deploying' }
  | DeployCompletedStatus
  | { kind: 'error'; message: string }

export function deployCompletionStatus(
  result: DeployCLIResult,
  audit: ApplicationRuntimeAudit
): DeployCompletedStatus {
  if (audit.backendDeploymentRequired || result.serverDeployment?.required === true) {
    return {
      kind: 'frontend-deployed',
      url: result.url,
      result,
      backendDeploymentRequired: true,
      notice: BACKEND_DEPLOYMENT_REQUIRED_NOTICE
    }
  }
  return { kind: 'done', url: result.url, result }
}

function sameBackendBuild(
  expected: PreparedAppBackendProviderBuild | null,
  current: PreparedAppBackendProviderBuild | null
): boolean {
  if (!expected || !current) return expected === current
  return (
    expected.plan.planDigest === current.plan.planDigest &&
    expected.emission.manifestDigest === current.emission.manifestDigest
  )
}

function deployScopeIsCurrent(
  requestStore: ReturnType<typeof getActiveEditorStore>,
  scope: string | undefined
): boolean {
  return requestStore === getActiveEditorStore() && deployScopeForStore(requestStore) === scope
}

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
    uiKit?: DeployUIKit,
    i18n?: DeployI18n,
    runtimeConfig?: DeployRuntimeConfig
  ) => Promise<void>
  history: Ref<DeployHistoryEntry[]>
  runtimeAudit: Ref<ApplicationRuntimeAudit | null>
  refreshHistory: () => void
  reset: () => void
}

export function useDeploy(): UseDeployResult {
  const status = ref<DeployStatus>({ kind: 'idle' })
  const history = ref<DeployHistoryEntry[]>(
    readDeployHistory(deployScopeForStore(getActiveEditorStore()))
  )
  const runtimeAudit = ref<ApplicationRuntimeAudit | null>(null)

  function reset(): void {
    status.value = { kind: 'idle' }
    runtimeAudit.value = null
  }

  function refreshHistory(): void {
    history.value = readDeployHistory(deployScopeForStore(getActiveEditorStore()))
  }

  async function deploy(
    token: string,
    provider: DeployProvider,
    environment: DeployEnvironment,
    site?: string,
    uiKit: DeployUIKit = 'none',
    i18n?: DeployI18n,
    runtimeConfig?: DeployRuntimeConfig
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
    const requestStore = getActiveEditorStore()
    const requestScope = deployScopeForStore(requestStore)
    const path = requestStore.getDocumentPath()
    if (!path) {
      status.value = {
        kind: 'error',
        message: 'Save the document to a .fig file first, then deploy.'
      }
      return
    }

    let backendBuild: PreparedAppBackendProviderBuild | null
    let audit: ApplicationRuntimeAudit
    try {
      backendBuild = prepareAppBackendProviderDocumentBuild(appPluginStore, requestStore.graph, {
        target: 'react',
        mode: 'production'
      })
      audit = await preflightDeployRuntime({
        graph: requestStore.graph,
        environment,
        runtimeConfig,
        backendProviderDeclared: backendBuild !== null
      })
    } catch (cause) {
      status.value = {
        kind: 'error',
        message: cause instanceof Error ? cause.message : String(cause)
      }
      return
    }
    if (!deployScopeIsCurrent(requestStore, requestScope)) return
    runtimeAudit.value = audit
    if (!audit.ready) {
      status.value = {
        kind: 'error',
        message: audit.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join(' ')
      }
      return
    }

    status.value = { kind: 'deploying' }
    try {
      const dispatchBackendBuild = prepareAppBackendProviderDocumentBuild(
        appPluginStore,
        requestStore.graph,
        { target: 'react', mode: 'production' }
      )
      if (!sameBackendBuild(backendBuild, dispatchBackendBuild)) {
        throw new Error(
          'Backend Provider selection or application changed after preflight. Review the deployment again.'
        )
      }
      const result = await runDeployCLI(
        path,
        trimmed,
        provider,
        environment,
        site,
        uiKit,
        i18n,
        runtimeConfig
      )
      const recorded = recordDeployHistory(
        {
          ...result,
          site,
          uiKit,
          i18nEnabled: i18n?.enabled ?? false,
          locales: i18n?.enabled ? i18n.locales : [],
          runtimeConfig
        },
        requestScope
      )
      if (!deployScopeIsCurrent(requestStore, requestScope)) return
      history.value = recorded
      status.value = deployCompletionStatus(result, audit)
    } catch (e) {
      if (!deployScopeIsCurrent(requestStore, requestScope)) return
      status.value = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }

  return { status, deploy, history, runtimeAudit, refreshHistory, reset }
}
