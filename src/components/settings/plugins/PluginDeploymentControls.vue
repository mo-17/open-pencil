<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle
} from 'reka-ui'

import { useI18n } from '@open-pencil/vue'
import type { BackendReleaseStateV1 } from '@open-pencil/lowcode/backend'

import { useEditorStore } from '@/app/editor/active-store'
import {
  recordDeployHistory,
  readDeployHistory,
  type DeployEnvironment,
  type DeployHistoryEntry,
  type DeployHistoryUIKit
} from '@/app/lowcode/preview-pane/deploy/history'
import { deployScopeForStore } from '@/app/lowcode/preview-pane/deploy/scope'
import {
  createDesktopDeploymentPluginHostAdapter,
  type DeploymentPluginParameters,
  type DeploymentPluginPlan,
  type DeploymentPluginReview
} from '@/app/plugins/host/deployment/provider'
import { appPluginStore } from '@/app/plugins/app'
import { REVIEWED_DEPLOYMENT_PLUGINS } from '@/app/plugins/host/deployment/contract'
import {
  deploymentPluginSessionSnapshot,
  runDeploymentPluginSession
} from '@/app/plugins/host/deployment/session'
import { runInstalledPluginCommand } from '@/app/plugins/host'
import type { InstalledAppPlugin, InstalledPluginCommand } from '@/app/plugins/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import type { CredentialStatus } from '@/app/settings/credentials/types'
import { isTauri } from '@/app/tauri/env'
import AppBadge from '@/components/ui/AppBadge.vue'
import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'

const { plugin } = defineProps<{ plugin: InstalledAppPlugin }>()
const { locale } = useI18n()
const editor = useEditorStore()

type Operation = 'status' | 'save-token' | 'clear-token' | 'review' | 'deploy'

const environment = ref<DeployEnvironment>('preview')
const target = ref('')
const uiKit = ref<DeployHistoryUIKit>('none')
const locales = ref('')
const credentialStatus = ref<CredentialStatus>('missing')
const operation = ref<Operation | null>(null)
const error = ref<string | null>(null)
const latestHistory = ref<DeployHistoryEntry | null>(null)
const pendingPlan = ref<DeploymentPluginPlan | null>(null)
const pendingParameters = ref<DeploymentPluginParameters | null>(null)
const pendingReview = ref<DeploymentPluginReview | null>(null)
const pendingHistoryScope = ref<string | null>(null)
const reviewOpen = ref(false)
let statusRevision = 0

const definition = computed(() =>
  REVIEWED_DEPLOYMENT_PLUGINS.find(
    (candidate) => candidate.pluginId === plugin.package.manifest.plugin.id
  )
)
const command = computed<InstalledPluginCommand['contribution'] | undefined>(() => {
  const value = definition.value
  return value
    ? plugin.package.manifest.contributions.commands?.find(
        (candidate) => candidate.commandId === value.mcpSafePlan.commandId
      )
    : undefined
})
const unavailable = computed(
  () => !definition.value || !command.value || !plugin.enabled || Boolean(plugin.blockedReason)
)
const configured = computed(() => credentialStatus.value === 'configured')
const desktopAvailable = isTauri()
const deploymentSession = computed(() => {
  const pluginId = definition.value?.pluginId
  return pluginId ? deploymentPluginSessionSnapshot.value[pluginId] : undefined
})
const deploymentActive = computed(() => deploymentSession.value?.status === 'deploying')
const controlsBusy = computed(() => operation.value !== null || deploymentActive.value)
const result = computed(() =>
  deploymentSession.value?.status === 'succeeded' ? deploymentSession.value.result : undefined
)
const notice = computed(() => deploymentSession.value?.notice)
const displayError = computed(
  () =>
    error.value ??
    (deploymentSession.value?.status === 'failed' ||
    deploymentSession.value?.status === 'outcome-unknown'
      ? deploymentSession.value.error
      : undefined)
)

const copy = computed(() =>
  locale.value === 'zh-CN'
    ? {
        title: '部署设置',
        description: '先检查计划，再确认部署。AI 只能生成计划，不能直接发布。',
        token: '访问令牌',
        tokenPlaceholder: '仅在保存时读取',
        saveToken: '保存令牌',
        replaceToken: '替换令牌',
        clearToken: '清除令牌',
        configured: '已配置',
        missing: '未配置',
        locked: '存储已锁定',
        unavailable: '存储不可用',
        environment: '环境标签',
        document: '审核文档',
        target: '部署目标',
        uiKit: 'UI 组件库',
        locales: '语言（逗号分隔）',
        review: '检查部署计划',
        reviewTitle: '确认远程部署',
        reviewDescription: '请核对目标和副作用。确认后才会读取令牌、构建并上传文件。',
        cancel: '返回修改',
        confirm: '确认并部署',
        deploying: '正在构建并部署…',
        success: '部署完成',
        latestDeployment: '最近一次部署',
        historyWarning: '远程部署已完成，但本地历史记录写入失败。',
        documentChanged:
          '远程部署已针对审核时的文档完成；当前文档已变化，结果仍记录在原文档历史中。',
        actionFailed: '操作失败',
        noSavedDocument: '请先保存当前文档，再执行部署。',
        credentialRequired: '部署前需要先保存访问令牌；你仍可在未配置令牌时检查计划。',
        desktopRequired: '真实部署仅在 Tauri 桌面应用中可用；AI 仍可生成无副作用的计划。',
        open: '打开部署结果'
      }
    : {
        title: 'Deployment settings',
        description:
          'Review the plan before confirming. AI can create the plan, but cannot deploy directly.',
        token: 'Access token',
        tokenPlaceholder: 'Read only while saving',
        saveToken: 'Save token',
        replaceToken: 'Replace token',
        clearToken: 'Clear token',
        configured: 'Configured',
        missing: 'Missing',
        locked: 'Storage locked',
        unavailable: 'Storage unavailable',
        environment: 'Environment label',
        document: 'Reviewed document',
        target: 'Deployment target',
        uiKit: 'UI kit',
        locales: 'Locales (comma separated)',
        review: 'Review deployment plan',
        reviewTitle: 'Confirm remote deployment',
        reviewDescription:
          'Verify the target and side effects. The token is read and files are built and uploaded only after confirmation.',
        cancel: 'Back to edit',
        confirm: 'Confirm and deploy',
        deploying: 'Building and deploying…',
        success: 'Deployment completed',
        latestDeployment: 'Latest deployment',
        historyWarning: 'The remote deployment succeeded, but local history could not be saved.',
        documentChanged:
          'The deployment completed for the reviewed document. The active document changed, so history remains attached to the original document.',
        actionFailed: 'Action failed',
        noSavedDocument: 'Save the current document before deploying.',
        credentialRequired:
          'Save an access token before deploying; you can still review the plan without one.',
        desktopRequired:
          'Live deployment is available only in the Tauri desktop app; AI can still create the side-effect-free plan.',
        open: 'Open deployment'
      }
)

function statusLabel(status: CredentialStatus): string {
  return copy.value[status]
}

function statusTone(status: CredentialStatus): 'success' | 'warning' | 'error' {
  if (status === 'configured') return 'success'
  if (status === 'missing') return 'warning'
  return 'error'
}

async function refreshCredentialStatus(): Promise<void> {
  const current = definition.value
  if (!current) return
  const revision = ++statusRevision
  operation.value = 'status'
  try {
    const next = await appCredentialServices.manager.status(current.credentialRef)
    if (revision === statusRevision) credentialStatus.value = next
  } catch {
    if (revision === statusRevision) credentialStatus.value = 'unavailable'
  } finally {
    if (revision === statusRevision && operation.value === 'status') operation.value = null
  }
}

async function saveToken(event: Event): Promise<void> {
  const current = definition.value
  const form = event.currentTarget
  if (!current || !(form instanceof HTMLFormElement)) return
  const input = form.elements.namedItem('deployment-token')
  if (!(input instanceof HTMLInputElement)) return
  const value = input.value.trim()
  if (!value) return
  input.value = ''
  operation.value = 'save-token'
  error.value = null
  try {
    await appCredentialServices.manager.set(current.credentialRef, value)
    credentialStatus.value = 'configured'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.actionFailed
  } finally {
    operation.value = null
  }
}

async function clearToken(): Promise<void> {
  const current = definition.value
  if (!current) return
  operation.value = 'clear-token'
  error.value = null
  try {
    await appCredentialServices.manager.clear(current.credentialRef)
    credentialStatus.value = 'missing'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.actionFailed
  } finally {
    operation.value = null
  }
}

function parameters(): DeploymentPluginParameters {
  const normalizedLocales = locales.value
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    environment: environment.value,
    ...(target.value.trim() ? { target: target.value.trim() } : {}),
    uiKit: uiKit.value,
    locales: normalizedLocales
  }
}

async function review(): Promise<void> {
  const contribution = command.value
  const current = definition.value
  if (!contribution || !current || unavailable.value) return
  operation.value = 'review'
  error.value = null
  pendingPlan.value = null
  pendingParameters.value = null
  pendingReview.value = null
  pendingHistoryScope.value = null
  try {
    const reviewedParameters = parameters()
    const planned = await runInstalledPluginCommand(
      editor,
      plugin,
      contribution,
      undefined,
      reviewedParameters
    )
    const plan = planned.data as DeploymentPluginPlan
    let hostReview: DeploymentPluginReview | null = null
    let historyScope: string | null = null
    if (plan.documentSaved) {
      const adapter = createDesktopDeploymentPluginHostAdapter(
        current,
        appCredentialServices.resolver,
        appPluginStore
      )
      hostReview = adapter.review(editor, reviewedParameters)
      historyScope = deployScopeForStore(editor) ?? null
      if (!historyScope) throw new Error(copy.value.noSavedDocument)
    }
    pendingPlan.value = plan
    pendingParameters.value = reviewedParameters
    pendingReview.value = hostReview
    pendingHistoryScope.value = historyScope
    reviewOpen.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.actionFailed
  } finally {
    operation.value = null
  }
}

async function deploy(): Promise<void> {
  const current = definition.value
  const plan = pendingPlan.value
  const reviewedParameters = pendingParameters.value
  const reviewedDocument = pendingReview.value
  const requestScope = pendingHistoryScope.value
  if (
    !current ||
    !plan ||
    !reviewedParameters ||
    !reviewedDocument ||
    !requestScope ||
    unavailable.value ||
    !desktopAvailable ||
    deploymentActive.value
  ) {
    return
  }
  reviewOpen.value = false
  operation.value = 'deploy'
  error.value = null
  const historyWarning = copy.value.historyWarning
  const documentChanged = copy.value.documentChanged
  try {
    const adapter = createDesktopDeploymentPluginHostAdapter(
      current,
      appCredentialServices.resolver,
      appPluginStore
    )
    await runDeploymentPluginSession({
      pluginId: current.pluginId,
      documentScope: requestScope,
      documentLabel: reviewedDocument.documentLabel,
      operation: async () => {
        let backendRelease: BackendReleaseStateV1 | undefined
        const deployed = await adapter.execute(editor, reviewedParameters, {
          confirm: () => true,
          expectedReview: reviewedDocument,
          onBackendReleaseState: (state) => {
            backendRelease = state
          }
        })
        let completionNotice: string | undefined
        try {
          const recorded = recordDeployHistory(
            {
              ...deployed,
              site: reviewedParameters.target,
              uiKit: reviewedParameters.uiKit,
              i18nEnabled: reviewedParameters.locales.length > 0,
              locales: [...reviewedParameters.locales]
            },
            requestScope
          )
          if (deployScopeForStore(editor) === requestScope)
            latestHistory.value = recorded[0] ?? null
        } catch {
          completionNotice = historyWarning
        }
        if (deployScopeForStore(editor) !== requestScope) {
          completionNotice = completionNotice
            ? `${completionNotice} ${documentChanged}`
            : documentChanged
        }
        return {
          result: deployed,
          ...(backendRelease ? { backendRelease } : {}),
          ...(completionNotice ? { notice: completionNotice } : {})
        }
      }
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : copy.value.actionFailed
  } finally {
    operation.value = null
    pendingPlan.value = null
    pendingParameters.value = null
    pendingReview.value = null
    pendingHistoryScope.value = null
  }
}

function refreshLatestHistory(): void {
  const provider = definition.value?.provider
  latestHistory.value = provider
    ? (readDeployHistory(deployScopeForStore(editor)).find(
        (entry) => entry.provider === provider
      ) ?? null)
    : null
}

watch(
  () => [plugin.package.manifest.plugin.id, plugin.enabled, plugin.blockedReason] as const,
  () => {
    refreshLatestHistory()
    void refreshCredentialStatus()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  statusRevision += 1
})
</script>

<template>
  <section
    v-if="definition"
    class="mt-2 rounded border border-border/70 bg-panel p-2 text-[9px] text-muted"
    data-test-id="plugin-deployment-controls"
    :aria-busy="deploymentActive"
  >
    <div class="flex items-start justify-between gap-2">
      <div>
        <h5 class="text-[10px] font-semibold text-surface">{{ copy.title }}</h5>
        <p>{{ copy.description }}</p>
      </div>
      <AppBadge :tone="statusTone(credentialStatus)">
        {{ statusLabel(credentialStatus) }}
      </AppBadge>
    </div>

    <form class="mt-2 flex gap-1" @submit.prevent="saveToken">
      <label class="min-w-0 flex-1">
        <span class="sr-only">{{ definition.ui.tokenLabel }}</span>
        <input
          name="deployment-token"
          type="password"
          autocomplete="off"
          required
          class="w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-surface"
          :placeholder="copy.tokenPlaceholder"
          :disabled="unavailable || controlsBusy"
        />
      </label>
      <button
        type="submit"
        class="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
        :disabled="unavailable || controlsBusy"
      >
        {{ configured ? copy.replaceToken : copy.saveToken }}
      </button>
      <button
        v-if="configured"
        type="button"
        class="rounded border border-border px-2 py-1 text-[10px] disabled:opacity-50"
        :disabled="unavailable || controlsBusy"
        @click="clearToken"
      >
        {{ copy.clearToken }}
      </button>
    </form>

    <div class="mt-2 grid grid-cols-2 gap-1.5">
      <label class="flex flex-col gap-0.5">
        <span>{{ copy.environment }}</span>
        <select
          v-model="environment"
          class="rounded border border-border bg-input px-2 py-1"
          :disabled="controlsBusy"
        >
          <option value="preview">Preview</option>
          <option value="staging">Staging</option>
          <option value="production">Production</option>
        </select>
      </label>
      <label class="flex flex-col gap-0.5">
        <span>{{ copy.uiKit }}</span>
        <select
          v-model="uiKit"
          class="rounded border border-border bg-input px-2 py-1"
          :disabled="controlsBusy"
        >
          <option value="none">None</option>
          <option value="shadcn">shadcn/ui</option>
        </select>
      </label>
      <label class="col-span-2 flex flex-col gap-0.5">
        <span>{{ copy.target }} · {{ definition.ui.targetPlaceholder }}</span>
        <input
          v-model="target"
          type="text"
          class="rounded border border-border bg-input px-2 py-1 text-surface"
          :required="definition.ui.targetRequired"
          :placeholder="definition.ui.targetPlaceholder"
          :disabled="controlsBusy"
        />
      </label>
      <label class="col-span-2 flex flex-col gap-0.5">
        <span>{{ copy.locales }}</span>
        <input
          v-model="locales"
          type="text"
          class="rounded border border-border bg-input px-2 py-1 text-surface"
          placeholder="zh-CN, en"
          :disabled="controlsBusy"
        />
      </label>
    </div>

    <p class="mt-1.5 rounded bg-panel-field px-2 py-1">{{ definition.ui.environmentNotice }}</p>
    <p v-if="!desktopAvailable" class="mt-1.5 text-warning" role="status">
      {{ copy.desktopRequired }}
    </p>
    <p v-if="deploymentActive" class="mt-1.5 text-accent" role="status" aria-live="polite">
      {{ copy.deploying }}
    </p>
    <p v-if="displayError" class="mt-1.5 text-error" role="alert">{{ displayError }}</p>
    <p v-if="notice" class="mt-1.5 text-warning" role="status">{{ notice }}</p>
    <div v-if="result" class="mt-1.5 rounded border border-success/50 px-2 py-1" role="status">
      <span class="text-success">{{ copy.success }}</span>
      <span v-if="deploymentSession?.documentLabel"> · {{ deploymentSession.documentLabel }}</span>
      ·
      <a class="text-accent underline" :href="result.url" target="_blank" rel="noreferrer">
        {{ copy.open }}
      </a>
    </div>
    <div
      v-else-if="latestHistory"
      class="mt-1.5 rounded border border-border px-2 py-1"
      role="status"
    >
      <span>{{ copy.latestDeployment }}</span>
      ·
      <a class="text-accent underline" :href="latestHistory.url" target="_blank" rel="noreferrer">
        {{ copy.open }}
      </a>
    </div>
    <button
      type="button"
      class="mt-2 rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
      :disabled="unavailable || controlsBusy"
      data-test-id="plugin-deployment-review"
      @click="review"
    >
      {{ deploymentActive ? copy.deploying : copy.review }}
    </button>

    <AppAlertDialogRoot v-model:open="reviewOpen" data-test-id="plugin-deployment-review-dialog">
      <header class="border-b border-border px-4 py-3">
        <AlertDialogTitle class="text-sm font-semibold text-surface">
          {{ copy.reviewTitle }}
        </AlertDialogTitle>
        <AlertDialogDescription class="mt-1 text-[11px] leading-4 text-muted">
          {{ copy.reviewDescription }}
        </AlertDialogDescription>
      </header>
      <AppDialogBody v-if="pendingPlan">
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <dt>Provider</dt>
          <dd class="text-surface">{{ pendingPlan.provider }}</dd>
          <dt>{{ copy.target }}</dt>
          <dd class="break-all text-surface">{{ pendingPlan.target }}</dd>
          <dt>{{ copy.environment }}</dt>
          <dd class="text-surface">{{ pendingPlan.environment }}</dd>
          <template v-if="pendingReview">
            <dt>{{ copy.document }}</dt>
            <dd class="break-all text-surface">{{ pendingReview.documentLabel }}</dd>
          </template>
        </dl>
        <p v-if="!pendingPlan.documentSaved" class="mt-2 text-error" role="alert">
          {{ copy.noSavedDocument }}
        </p>
        <p v-if="!desktopAvailable" class="mt-2 text-warning" role="alert">
          {{ copy.desktopRequired }}
        </p>
        <p v-if="!configured" class="mt-2 text-warning" role="status">
          {{ copy.credentialRequired }}
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-4 text-[11px] text-muted">
          <li v-for="item in pendingPlan.sideEffects" :key="item">{{ item }}</li>
        </ul>
      </AppDialogBody>
      <AppDialogFooter>
        <AlertDialogCancel as-child>
          <button type="button" class="rounded border border-border px-3 py-1.5 text-[11px]">
            {{ copy.cancel }}
          </button>
        </AlertDialogCancel>
        <AlertDialogAction as-child>
          <button
            type="button"
            class="rounded bg-danger px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
            :disabled="
              !pendingPlan?.documentSaved ||
              !pendingReview ||
              !configured ||
              !desktopAvailable ||
              controlsBusy
            "
            data-test-id="plugin-deployment-confirm"
            @click="deploy"
          >
            {{ copy.confirm }}
          </button>
        </AlertDialogAction>
      </AppDialogFooter>
    </AppAlertDialogRoot>
  </section>
</template>
