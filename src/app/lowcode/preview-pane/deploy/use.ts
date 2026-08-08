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

import type { ApplicationRuntimeAudit } from '@open-pencil/core/lowcode-validation/application-runtime'

import { getActiveEditorStore } from '@/app/editor/active-store'
import { isTauri } from '@/app/tauri/env'

import type { DeployCliResult } from './command'
import {
  recordDeployHistory,
  readDeployHistory,
  type DeployEnvironment,
  type DeployHistoryEntry,
  type DeployRuntimeConfig
} from './history'
import { runDeployCli, type DeployI18n, type DeployProvider, type DeployUiKit } from './runner'
import {
  auditDeployRuntime,
  readDeployKnownTables,
  resolveEffectiveDeploySupabaseConfig
} from './runtime-preflight'
import { deployScopeForStore } from './scope'

export type { DeployI18n, DeployProvider, DeployUiKit } from './runner'
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
    uiKit: DeployUiKit = 'none',
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

    const effectiveSupabaseConfig = resolveEffectiveDeploySupabaseConfig(
      requestStore.graph,
      runtimeConfig
    )
    const knownTables = await readDeployKnownTables(effectiveSupabaseConfig)
    if (
      requestStore !== getActiveEditorStore() ||
      deployScopeForStore(requestStore) !== requestScope
    ) {
      return
    }
    const audit = auditDeployRuntime({
      graph: requestStore.graph,
      environment,
      runtimeConfig,
      knownTables
    })
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
      const result = await runDeployCli(
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
      if (
        requestStore !== getActiveEditorStore() ||
        deployScopeForStore(requestStore) !== requestScope
      ) {
        return
      }
      history.value = recorded
      status.value = { kind: 'done', url: result.url, result }
    } catch (e) {
      if (
        requestStore !== getActiveEditorStore() ||
        deployScopeForStore(requestStore) !== requestScope
      ) {
        return
      }
      status.value = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }

  return { status, deploy, history, runtimeAudit, refreshHistory, reset }
}
