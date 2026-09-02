<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { useSceneComputed } from '@open-pencil/vue'

import {
  getActiveEditorStore,
  useActiveEditorStoreRef,
  useEditorStore
} from '@/app/editor/active-store'
import { openExternalLink } from '@/app/shell/ui'
import Tip from '@/components/ui/Tip.vue'

const { iconOnly = false, showIcon = false } = defineProps<{
  iconOnly?: boolean
  showIcon?: boolean
}>()

import {
  deployArtifactLabel,
  deployBuildOptionsSnapshot,
  deployDashboardURL,
  deployRollbackContract,
  deployRollbackContractLabel,
  deployRollbackContractTitle,
  deployRollbackDraft,
  deployRuntimeConfigSnapshot,
  readDeployTargetPresets,
  saveDeployTargetPreset,
  restoreNetlifyDeploy,
  type DeployEnvironment,
  type DeployHistoryEntry,
  type DeployRuntimeConfig
} from './deploy/history'
import { deployScopeForStore } from './deploy/scope'
import { useDeploy, type DeployProvider, type DeployUIKit } from './deploy/use'

/** Split the comma/space-separated locale field into clean target codes. */
function parseLocales(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

// Phase 3 §5: one-click deploy from the preview header. The token lives only in
// this component's memory (never persisted) and is handed to the deploy CLI via
// the spawned process env (see deploy/use.ts). §5.4 adds a provider picker
// (Netlify / Vercel / Cloudflare). Plain English strings match the (non-i18n)
// PreviewPane sibling.
const { status, deploy, history, runtimeAudit, refreshHistory, reset } = useDeploy()
const store = useEditorStore()
const activeStoreRef = useActiveEditorStoreRef()

const open = ref(false)
const provider = ref<DeployProvider>('netlify')
const environment = ref<DeployEnvironment>('preview')
const token = ref('')
const site = ref('')
// Phase 3 §15: code UI kit for the emitted project ('none' → plain Tailwind).
const uiKit = ref<DeployUIKit>('none')
// Phase 3 §9: enable the i18n runtime + a comma-separated target-locale list.
const i18nEnabled = ref(false)
const localesInput = ref('')
const supabaseURL = ref('')
const supabasePublishableKey = ref('')
const supabaseSchema = ref('')
const runtimeError = ref<string | null>(null)
const rollbackNotice = ref<string | null>(null)
const targetNotice = ref<string | null>(null)
const targetPresets = ref(readDeployTargetPresets(currentDocumentScope()))
let suppressEnvironmentPreset = false
let unbindSourceChanged: (() => void) | undefined

function currentDocumentScope(): string | undefined {
  return deployScopeForStore(getActiveEditorStore())
}

function currentRuntimeConfig(): DeployRuntimeConfig | undefined {
  return deployRuntimeConfigSnapshot({
    supabaseUrl: supabaseURL.value,
    supabasePublishableKey: supabasePublishableKey.value,
    supabaseSchema: supabaseSchema.value
  })
}

function clearRuntimeOverrides(): void {
  supabaseURL.value = ''
  supabasePublishableKey.value = ''
  supabaseSchema.value = ''
}

function resetTargetFields(): void {
  provider.value = 'netlify'
  site.value = ''
  uiKit.value = 'none'
  i18nEnabled.value = false
  localesInput.value = ''
  clearRuntimeOverrides()
}

function applyRuntimeConfig(config: DeployRuntimeConfig | undefined): void {
  supabaseURL.value = config?.supabaseUrl ?? ''
  supabasePublishableKey.value = config?.supabasePublishableKey ?? config?.supabaseAnonKey ?? ''
  supabaseSchema.value = config?.supabaseSchema ?? ''
}

const designSupabaseConfig = useSceneComputed(
  () => store.graph.getNode(store.graph.rootId)?.lowcodeSupabaseConfig
)

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

function setOpen(nextOpen: boolean): void {
  open.value = nextOpen
  if (!nextOpen) {
    token.value = ''
    reset()
    return
  }
  refreshHistory()
  targetPresets.value = readDeployTargetPresets(currentDocumentScope())
  applyEnvironmentPreset(environment.value)
}

function openDeploy(): void {
  setOpen(true)
}

defineExpose({ openDeploy })

function currentBuildOptions() {
  return deployBuildOptionsSnapshot({
    uiKit: uiKit.value,
    i18nEnabled: i18nEnabled.value,
    locales: parseLocales(localesInput.value)
  })
}

async function submit(): Promise<void> {
  rollbackNotice.value = null
  let runtimeConfig: DeployRuntimeConfig | undefined
  try {
    runtimeConfig = currentRuntimeConfig()
    runtimeError.value = null
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : String(error)
    return
  }
  await deploy(
    token.value,
    provider.value,
    environment.value,
    site.value.trim() || undefined,
    uiKit.value,
    {
      enabled: i18nEnabled.value,
      locales: parseLocales(localesInput.value)
    },
    runtimeConfig
  )
  if (status.value.kind === 'done' || status.value.kind === 'frontend-deployed') token.value = ''
}

function restoreForRollback(entry: DeployHistoryEntry): void {
  const draft = deployRollbackDraft(entry)
  if (!draft) return
  suppressEnvironmentPreset = true
  reset()
  provider.value = draft.provider
  environment.value = draft.environment
  site.value = draft.site ?? ''
  uiKit.value = draft.uiKit
  i18nEnabled.value = draft.i18nEnabled
  localesInput.value = draft.locales.join(', ')
  applyRuntimeConfig(draft.runtimeConfig)
  rollbackNotice.value = `Ready to redeploy ${entry.environment} from ${entry.deployId}. Enter a ${draft.provider} token, then deploy.`
  void nextTick(() => {
    suppressEnvironmentPreset = false
  })
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
  if (!preset) {
    resetTargetFields()
    targetNotice.value = null
    return
  }
  provider.value = preset.provider
  site.value = preset.site ?? ''
  uiKit.value = preset.buildOptions.uiKit
  i18nEnabled.value = preset.buildOptions.i18nEnabled
  localesInput.value = preset.buildOptions.locales.join(', ')
  applyRuntimeConfig(preset.runtimeConfig)
  targetNotice.value = `Using saved ${nextEnvironment} target.`
}

function saveCurrentTarget(): void {
  try {
    targetPresets.value = saveDeployTargetPreset(
      {
        environment: environment.value,
        provider: provider.value,
        site: site.value.trim() || undefined,
        buildOptions: currentBuildOptions(),
        runtimeConfig: currentRuntimeConfig()
      },
      currentDocumentScope()
    )
    runtimeError.value = null
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : String(error)
    return
  }
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
  return deployRollbackContractLabel(deployRollbackContract(entry))
}

function rollbackContractTitle(entry: DeployHistoryEntry): string {
  return deployRollbackContractTitle(deployRollbackContract(entry))
}

watch(provider, (next, previous) => {
  if (next !== previous) token.value = ''
})

watch(environment, (next) => {
  if (suppressEnvironmentPreset) return
  rollbackNotice.value = null
  applyEnvironmentPreset(next)
})

function reloadDocumentDeployState(): void {
  token.value = ''
  reset()
  runtimeError.value = null
  rollbackNotice.value = null
  targetPresets.value = readDeployTargetPresets(currentDocumentScope())
  refreshHistory()
  applyEnvironmentPreset(environment.value)
}

const stopActiveStoreWatch = watch(
  activeStoreRef,
  (activeStore) => {
    unbindSourceChanged?.()
    unbindSourceChanged = activeStore?.onSourceChanged(reloadDocumentDeployState)
    reloadDocumentDeployState()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  stopActiveStoreWatch()
  unbindSourceChanged?.()
  token.value = ''
})
</script>

<template>
  <PopoverRoot :open="open" @update:open="setOpen">
    <PopoverTrigger as-child>
      <button
        type="button"
        data-test-id="lowcode-deploy-toggle"
        aria-label="Deploy"
        class="flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
      >
        <icon-lucide-rocket v-if="showIcon || iconOnly" class="size-3.5" />
        <span v-if="!iconOnly">Deploy</span>
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        class="z-[120] max-h-[calc(100vh-4rem)] w-64 overflow-y-auto rounded border border-border bg-panel p-3 shadow-lg"
        data-test-id="lowcode-deploy-panel"
        :side-offset="6"
        side="bottom"
        align="end"
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

        <details class="mb-2 rounded border border-border px-2 py-1.5">
          <summary class="cursor-pointer text-xs text-muted">Runtime overrides</summary>
          <p class="mt-1 text-[10px] text-muted">
            Leave blank to use the design-time Supabase configuration.
          </p>
          <p
            v-if="designSupabaseConfig"
            class="mt-1 truncate font-mono text-[10px] text-muted"
            data-test-id="lowcode-deploy-runtime-fallback"
          >
            Fallback: {{ designSupabaseConfig.url }} ·
            {{ designSupabaseConfig.schema || 'public' }}
          </p>
          <label class="mb-1 mt-2 block text-[11px] text-muted">Supabase URL</label>
          <input
            v-model="supabaseURL"
            type="url"
            data-test-id="lowcode-deploy-supabase-url"
            placeholder="https://project.supabase.co"
            spellcheck="false"
            autocomplete="off"
            class="mb-1.5 w-full rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface"
            :disabled="status.kind === 'deploying'"
          />
          <label class="mb-1 block text-[11px] text-muted">
            Publishable key (legacy anon accepted)
          </label>
          <input
            v-model="supabasePublishableKey"
            type="password"
            data-test-id="lowcode-deploy-supabase-anon-key"
            placeholder="sb_publishable_… or anon JWT"
            spellcheck="false"
            autocomplete="off"
            class="mb-1.5 w-full rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface"
            :disabled="status.kind === 'deploying'"
          />
          <label class="mb-1 block text-[11px] text-muted">Database schema</label>
          <input
            v-model="supabaseSchema"
            type="text"
            data-test-id="lowcode-deploy-supabase-schema"
            placeholder="public"
            spellcheck="false"
            autocomplete="off"
            class="w-full rounded border border-border bg-input px-2 py-1 font-mono text-[11px] text-surface"
            :disabled="status.kind === 'deploying'"
          />
          <p
            v-if="runtimeError"
            role="alert"
            data-test-id="lowcode-deploy-runtime-error"
            class="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
          >
            {{ runtimeError }}
          </p>
        </details>

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
          ✓ Application deployed —
          <button type="button" class="text-accent underline" @click="openDeployed(status.url)">
            open site
          </button>
          <span class="block">
            {{ status.result.environment }} · {{ status.result.provider }} ·
            {{ status.result.deployId }}
          </span>
        </p>
        <p
          v-if="status.kind === 'frontend-deployed'"
          class="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-muted"
          data-test-id="lowcode-deploy-frontend-only"
        >
          <span class="font-medium text-surface">
            Static frontend deployed — backend verification required.
          </span>
          <button
            type="button"
            class="ml-1 text-accent underline"
            @click="openDeployed(status.url)"
          >
            open static site
          </button>
          <span class="mt-1 block">
            {{ status.result.environment }} · {{ status.result.provider }} ·
            {{ status.result.deployId }}
          </span>
          <span class="mt-1 block">{{ status.notice }}</span>
        </p>
        <div
          v-if="
            (status.kind === 'done' || status.kind === 'frontend-deployed') &&
            status.result.serverDeployment
          "
          class="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-muted"
          data-test-id="lowcode-deploy-server-manual"
        >
          <div class="font-medium text-surface">Manual server deployment required</div>
          <p class="mt-1 break-words">{{ status.result.serverDeployment.warning }}</p>
          <p class="mt-1 break-all font-mono text-[10px]">
            Artifact: {{ status.result.serverDeployment.artifactDirectory }}
          </p>
          <ol class="mt-1 list-decimal space-y-1 pl-4">
            <li v-for="command in status.result.serverDeployment.commands" :key="command">
              <code class="select-all break-all text-[10px] text-surface">{{ command }}</code>
            </li>
          </ol>
        </div>
        <p
          v-else-if="status.kind === 'error'"
          class="mt-2 break-words text-xs text-red-500"
          data-test-id="lowcode-deploy-error"
        >
          {{ status.message }}
        </p>

        <div
          v-if="runtimeAudit && runtimeAudit.issues.length > 0"
          class="mt-2 rounded border border-border px-2 py-1 text-[11px] text-muted"
          data-test-id="lowcode-deploy-runtime-audit"
        >
          <div class="font-medium text-surface">Runtime preflight</div>
          <ul class="mt-1 list-disc space-y-0.5 pl-4">
            <li
              v-for="issue in runtimeAudit.issues"
              :key="issue.code"
              :class="issue.severity === 'error' ? 'text-red-500' : ''"
            >
              {{ issue.message }}
            </li>
          </ul>
        </div>

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
              <Tip :label="artifactLabel(entry)">
                <div class="truncate">{{ artifactLabel(entry) }}</div>
              </Tip>
              <div class="truncate">{{ buildOptionsLabel(entry) }}</div>
              <Tip :label="rollbackContractTitle(entry)">
                <div class="truncate">
                  {{ rollbackContractLabel(entry) }}
                </div>
              </Tip>
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
                <template v-if="deployDashboardURL(entry)">
                  or
                  <button
                    type="button"
                    class="text-accent underline"
                    @click="openDeployed(deployDashboardURL(entry)!)"
                  >
                    open dashboard
                  </button>
                </template>
                <template v-else>or use the provider dashboard.</template>
              </div>
            </li>
          </ul>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
