<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { openExternalLink } from '@/app/shell/ui'

import {
  deployArtifactLabel,
  deployBuildOptionsSnapshot,
  deployDashboardUrl,
  deployRollbackContract,
  deployRollbackDraft,
  readDeployTargetPresets,
  saveDeployTargetPreset,
  restoreNetlifyDeploy,
  type DeployEnvironment,
  type DeployHistoryEntry
} from './deploy-history'
import { useDeploy, type DeployProvider, type DeployUiKit } from './use-deploy'

/** Split the comma/space-separated locale field into clean target codes. */
function parseLocales(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

// Phase 3 §5: one-click deploy from the preview header. The token lives only in
// this component's memory (never persisted) and is handed to the deploy CLI via
// the spawned process env (see use-deploy.ts). §5.4 adds a provider picker
// (Netlify / Vercel / Cloudflare). Plain English strings match the (non-i18n)
// PreviewPane sibling.
const { status, deploy, history, reset } = useDeploy()

const open = ref(false)
const provider = ref<DeployProvider>('netlify')
const environment = ref<DeployEnvironment>('preview')
const token = ref('')
const site = ref('')
// Phase 3 §15: code UI kit for the emitted project ('none' → plain Tailwind).
const uiKit = ref<DeployUiKit>('none')
// Phase 3 §9: enable the i18n runtime + a comma-separated target-locale list.
const i18nEnabled = ref(false)
const localesInput = ref('')
const rollbackNotice = ref<string | null>(null)
const targetNotice = ref<string | null>(null)
const targetPresets = ref(readDeployTargetPresets())

const tokenLabel = computed(() => {
  if (provider.value === 'cloudflare') return 'Cloudflare token'
  return provider.value === 'vercel' ? 'Vercel token' : 'Netlify token'
})
const targetLabel = computed(() => {
  if (provider.value === 'cloudflare') return 'Account / project (required)'
  if (provider.value === 'vercel') return 'Project (optional)'
  return 'Site (optional)'
})
const targetPlaceholder = computed(() => {
  if (provider.value === 'cloudflare') return 'account-id/project-name'
  if (provider.value === 'vercel') return 'existing project name'
  return 'existing site id / subdomain'
})

function toggle(): void {
  open.value = !open.value
  if (!open.value) reset()
}

function currentBuildOptions() {
  return deployBuildOptionsSnapshot({
    uiKit: uiKit.value,
    i18nEnabled: i18nEnabled.value,
    locales: parseLocales(localesInput.value)
  })
}

async function submit(): Promise<void> {
  rollbackNotice.value = null
  await deploy(
    token.value,
    provider.value,
    environment.value,
    site.value.trim() || undefined,
    uiKit.value,
    {
      enabled: i18nEnabled.value,
      locales: parseLocales(localesInput.value)
    }
  )
}

function restoreForRollback(entry: DeployHistoryEntry): void {
  const draft = deployRollbackDraft(entry)
  if (!draft) return
  reset()
  provider.value = draft.provider
  environment.value = draft.environment
  site.value = draft.site ?? ''
  uiKit.value = draft.uiKit
  i18nEnabled.value = draft.i18nEnabled
  localesInput.value = draft.locales.join(', ')
  rollbackNotice.value = `Ready to redeploy ${entry.environment} from ${entry.deployId}. Enter a ${draft.provider} token, then deploy.`
}

async function restoreProviderDeploy(entry: DeployHistoryEntry): Promise<void> {
  const contract = deployRollbackContract(entry)
  if (entry.provider !== 'netlify' || contract.support !== 'api-candidate' || !entry.site) return
  try {
    const result = await restoreNetlifyDeploy({
      token: token.value,
      siteId: entry.site,
      deployId: entry.deployId
    })
    rollbackNotice.value = `Restored Netlify deploy ${result.deployId}${result.url ? ` · ${result.url}` : ''}.`
  } catch (e) {
    rollbackNotice.value = e instanceof Error ? e.message : String(e)
  }
}

function applyEnvironmentPreset(nextEnvironment: DeployEnvironment): void {
  const preset = targetPresets.value[nextEnvironment]
  if (!preset) return
  provider.value = preset.provider
  site.value = preset.site ?? ''
  uiKit.value = preset.buildOptions.uiKit
  i18nEnabled.value = preset.buildOptions.i18nEnabled
  localesInput.value = preset.buildOptions.locales.join(', ')
  targetNotice.value = `Using saved ${nextEnvironment} target.`
}

function saveCurrentTarget(): void {
  targetPresets.value = saveDeployTargetPreset({
    environment: environment.value,
    provider: provider.value,
    site: site.value.trim() || undefined,
    buildOptions: currentBuildOptions()
  })
  targetNotice.value = `Saved ${environment.value} target.`
}

function openDeployed(url: string): void {
  void openExternalLink(url)
}

function artifactLabel(entry: DeployHistoryEntry): string {
  return entry.artifactLabel ?? deployArtifactLabel(entry)
}

function buildOptionsLabel(entry: DeployHistoryEntry): string {
  const options = deployBuildOptionsSnapshot(entry)
  const parts = [options.uiKit === 'shadcn' ? 'shadcn/ui' : 'Tailwind']
  if (options.i18nEnabled) {
    parts.push(options.locales.length > 0 ? `i18n ${options.locales.join(', ')}` : 'i18n')
  }
  return parts.join(' · ')
}

function rollbackContractLabel(entry: DeployHistoryEntry): string {
  const contract = deployRollbackContract(entry)
  if (contract.support === 'api-candidate') return `${contract.label} API candidate`
  if (contract.support === 'dashboard-only') return `${contract.label}: dashboard only`
  return 'Rollback unsupported'
}

watch(environment, (next) => {
  rollbackNotice.value = null
  applyEnvironmentPreset(next)
})

applyEnvironmentPreset(environment.value)
</script>

<template>
  <div class="relative">
    <button
      type="button"
      data-test-id="lowcode-deploy-toggle"
      class="rounded px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-surface"
      title="Deploy"
      @click="toggle"
    >
      Deploy
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-7 z-10 w-64 rounded border border-border bg-panel p-3 shadow-lg"
      data-test-id="lowcode-deploy-panel"
    >
      <label class="mb-1 block text-xs text-muted">Provider</label>
      <select
        v-model="provider"
        data-test-id="lowcode-deploy-provider"
        class="mb-2 w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        :disabled="status.kind === 'deploying'"
      >
        <option value="netlify">Netlify</option>
        <option value="vercel">Vercel</option>
        <option value="cloudflare">Cloudflare</option>
      </select>

      <label class="mb-1 block text-xs text-muted">Environment</label>
      <select
        v-model="environment"
        data-test-id="lowcode-deploy-environment"
        class="mb-2 w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        :disabled="status.kind === 'deploying'"
      >
        <option value="preview">Preview</option>
        <option value="staging">Staging</option>
        <option value="production">Production</option>
      </select>

      <label class="mb-1 block text-xs text-muted">UI components</label>
      <select
        v-model="uiKit"
        data-test-id="lowcode-deploy-uikit"
        class="mb-2 w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        :disabled="status.kind === 'deploying'"
      >
        <option value="none">Tailwind (self-contained)</option>
        <option value="shadcn">shadcn/ui</option>
      </select>

      <label class="mb-2 flex items-center gap-2 text-xs text-muted">
        <input
          v-model="i18nEnabled"
          type="checkbox"
          data-test-id="lowcode-deploy-i18n"
          :disabled="status.kind === 'deploying'"
        />
        Multi-language (i18n)
      </label>
      <input
        v-if="i18nEnabled"
        v-model="localesInput"
        type="text"
        data-test-id="lowcode-deploy-locales"
        placeholder="target locales, e.g. ar, fr, ja"
        class="mb-2 w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        :disabled="status.kind === 'deploying'"
        @keydown.enter="submit"
      />

      <label class="mb-1 block text-xs text-muted">{{ tokenLabel }}</label>
      <input
        v-model="token"
        type="password"
        data-test-id="lowcode-deploy-token"
        placeholder="Personal access token"
        class="mb-2 w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        :disabled="status.kind === 'deploying'"
        @keydown.enter="submit"
      />
      <label class="mb-1 block text-xs text-muted">{{ targetLabel }}</label>
      <input
        v-model="site"
        type="text"
        data-test-id="lowcode-deploy-site"
        :placeholder="targetPlaceholder"
        class="mb-2 w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        :disabled="status.kind === 'deploying'"
        @keydown.enter="submit"
      />

      <button
        type="button"
        data-test-id="lowcode-deploy-save-target"
        class="mb-2 w-full rounded border border-border px-2 py-1 text-xs text-muted hover:bg-hover hover:text-surface"
        :disabled="status.kind === 'deploying'"
        @click="saveCurrentTarget"
      >
        Save {{ environment }} target
      </button>

      <p
        v-if="targetNotice"
        class="mb-2 break-words text-[11px] text-muted"
        data-test-id="lowcode-deploy-target-preset"
      >
        {{ targetNotice }}
      </p>

      <button
        type="button"
        data-test-id="lowcode-deploy-submit"
        class="w-full rounded bg-accent px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
        :disabled="status.kind === 'deploying'"
        @click="submit"
      >
        {{ status.kind === 'deploying' ? 'Deploying…' : 'Build & Deploy' }}
      </button>

      <p
        v-if="rollbackNotice"
        class="mt-2 break-words text-xs text-muted"
        data-test-id="lowcode-deploy-rollback-draft"
      >
        {{ rollbackNotice }}
      </p>

      <p
        v-if="status.kind === 'done'"
        class="mt-2 text-xs text-muted"
        data-test-id="lowcode-deploy-done"
      >
        ✓ Deployed —
        <button type="button" class="text-accent underline" @click="openDeployed(status.url)">
          open site
        </button>
        <span class="block">
          {{ status.result.environment }} · {{ status.result.provider }} ·
          {{ status.result.deployId }}
        </span>
      </p>
      <p
        v-else-if="status.kind === 'error'"
        class="mt-2 break-words text-xs text-red-500"
        data-test-id="lowcode-deploy-error"
      >
        {{ status.message }}
      </p>

      <div v-if="history.length > 0" class="mt-3 border-t border-border pt-2">
        <div class="mb-1 text-[11px] font-medium text-muted">Recent deploys</div>
        <ul
          class="flex max-h-32 flex-col gap-1 overflow-y-auto"
          data-test-id="lowcode-deploy-history"
        >
          <li
            v-for="entry in history"
            :key="entry.id"
            class="rounded border border-border px-2 py-1 text-[11px] text-muted"
            data-test-id="lowcode-deploy-history-item"
          >
            <div class="flex items-center gap-1">
              <span class="font-medium text-surface">{{ entry.environment }}</span>
              <span>· {{ entry.provider }}</span>
              <button
                type="button"
                class="ml-auto text-accent underline"
                @click="openDeployed(entry.url)"
              >
                open
              </button>
            </div>
            <div class="truncate" :title="artifactLabel(entry)">{{ artifactLabel(entry) }}</div>
            <div class="truncate">{{ buildOptionsLabel(entry) }}</div>
            <div class="truncate" :title="deployRollbackContract(entry).reason">
              {{ rollbackContractLabel(entry) }}
            </div>
            <div class="truncate">Deploy {{ entry.deployId }}</div>
            <div class="truncate">
              Rollback:
              <button
                v-if="
                  entry.provider === 'netlify' &&
                  deployRollbackContract(entry).support === 'api-candidate'
                "
                type="button"
                class="text-accent underline"
                data-test-id="lowcode-deploy-history-restore"
                @click="restoreProviderDeploy(entry)"
              >
                restore deploy
              </button>
              <button
                v-if="deployRollbackDraft(entry)"
                type="button"
                class="ml-1 text-accent underline"
                data-test-id="lowcode-deploy-history-redeploy"
                @click="restoreForRollback(entry)"
              >
                redeploy this environment
              </button>
              <template v-else>redeploy this environment</template>
              <template v-if="deployDashboardUrl(entry)">
                or
                <button
                  type="button"
                  class="text-accent underline"
                  @click="openDeployed(deployDashboardUrl(entry)!)"
                >
                  open dashboard
                </button>
              </template>
              <template v-else>or use the provider dashboard.</template>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
