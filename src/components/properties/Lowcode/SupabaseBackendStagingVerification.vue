<script setup lang="ts">
import { computed, onScopeDispose, ref, toRef, watch } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { useSupabaseBackendStagingVerification } from '@/app/lowcode/supabase/backend-staging-verification'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop-supabase-backend-review'
import { isTauri } from '@/app/tauri/env'

const { config, reviewed, projectRefConfirmation, confirmedIndependentStaging, disabled } =
  defineProps<{
    config?: SupabaseConfig
    reviewed: DesktopSupabaseBackendReviewResult
    projectRefConfirmation: string
    confirmedIndependentStaging: boolean
    disabled?: boolean
  }>()

const emit = defineEmits<{ busy: [value: boolean] }>()
const { panels } = useI18n()
const editor = useEditorStore()
const configRef = toRef(() => config)
const reviewedRef = toRef(() => reviewed)
const verification = useSupabaseBackendStagingVerification(
  configRef,
  reviewedRef,
  () => editor.graph
)

const edgeAccessTokenInput = ref<HTMLInputElement>()
const userAAccessTokenInput = ref<HTMLInputElement>()
const userBAccessTokenInput = ref<HTMLInputElement>()
const userAId = ref('')
const userBId = ref('')
const tenantPartitionsJSON = ref('')
const localError = ref<'invalid-tenant-partitions' | null>(null)

const busy = computed(() => verification.state.value === 'loading')
const canVerify = computed(
  () =>
    isTauri() &&
    !disabled &&
    !busy.value &&
    verification.state.value !== 'outcome-unknown' &&
    reviewed.reviewReady &&
    reviewed.blockerCount === 0 &&
    projectRefConfirmation === reviewed.projectRef &&
    confirmedIndependentStaging
)

const outcomeLabel = computed(() => {
  const outcome = verification.result.value?.receipt.outcome
  if (outcome === 'succeeded') return panels.value.lowcodeSupabaseBackendStagingSucceeded
  if (outcome === 'blocked') return panels.value.lowcodeSupabaseBackendStagingBlocked
  if (outcome === 'outcome-unknown') {
    return panels.value.lowcodeSupabaseBackendStagingOutcomeUnknown
  }
  return outcome === 'failed' ? panels.value.lowcodeSupabaseBackendStagingFailed : ''
})

const errorMessage = computed(() => {
  if (localError.value === 'invalid-tenant-partitions') {
    return panels.value.lowcodeSupabaseBackendCapabilityTenantInvalid
  }
  const code = verification.error.value
  if (code === 'desktop-required') return panels.value.lowcodeSupabaseBackendStagingDesktopOnly
  if (code === 'binding-mismatch' || code === 'binding-unavailable') {
    return panels.value.lowcodeSupabaseBackendStagingBindingError
  }
  if (
    code === 'credential-missing' ||
    code === 'write-credential-missing' ||
    code === 'write-credential-not-independent' ||
    code === 'grant-unavailable' ||
    code === 'grant-changed'
  ) {
    return panels.value.lowcodeSupabaseBackendStagingCredentialError
  }
  if (code === 'backend-provider-missing' || code === 'backend-provider-unavailable') {
    return panels.value.lowcodeSupabaseBackendStagingProviderError
  }
  if (code === 'review-stale' || code === 'invalid-config') {
    return panels.value.lowcodeSupabaseBackendStagingReviewStale
  }
  if (code === 'schema-not-applied') {
    return panels.value.lowcodeSupabaseBackendCapabilitySchemaNotApplied
  }
  if (code === 'transient-auth-missing') {
    return panels.value.lowcodeSupabaseBackendCapabilityAuthMissing
  }
  if (code === 'aborted') return panels.value.lowcodeSupabaseBackendCapabilityCancelled
  return code ? panels.value.lowcodeSupabaseBackendCapabilityFailed : ''
})

function tenantPartitions() {
  const source = tenantPartitionsJSON.value.trim()
  if (!source) return undefined
  const parsed: unknown = JSON.parse(source)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('tenant partitions must be a record')
  }
  const result: Record<string, Readonly<{ allowedPartition: string; deniedPartition: string }>> = {}
  const entries = Object.entries(parsed)
  if (entries.length > 64) throw new TypeError('too many tenant partitions')
  for (const [key, value] of entries) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Reflect.ownKeys(value).length !== 2 ||
      typeof Reflect.get(value, 'allowedPartition') !== 'string' ||
      typeof Reflect.get(value, 'deniedPartition') !== 'string'
    ) {
      throw new TypeError('tenant partition entry is invalid')
    }
    result[key] = Object.freeze({
      allowedPartition: Reflect.get(value, 'allowedPartition') as string,
      deniedPartition: Reflect.get(value, 'deniedPartition') as string
    })
  }
  return Object.freeze(result)
}

interface TransientTokens {
  edge: string
  userA: string
  userB: string
}

function readTransientTokens(): TransientTokens {
  return {
    edge: edgeAccessTokenInput.value?.value ?? '',
    userA: userAAccessTokenInput.value?.value ?? '',
    userB: userBAccessTokenInput.value?.value ?? ''
  }
}

function clearTokenInputs(): void {
  for (const input of [
    edgeAccessTokenInput.value,
    userAAccessTokenInput.value,
    userBAccessTokenInput.value
  ]) {
    if (input) input.value = ''
  }
}

function stagingUser(userId: string, accessToken: string) {
  const normalizedUserId = userId.trim()
  return normalizedUserId && accessToken ? { userId: normalizedUserId, accessToken } : undefined
}

function verificationRequest(
  tokens: TransientTokens,
  partitions: ReturnType<typeof tenantPartitions>
) {
  const storageUserA = stagingUser(userAId.value, tokens.userA)
  const storageUserB = stagingUser(userBId.value, tokens.userB)
  return {
    projectRefConfirmation,
    confirmedIndependentStaging,
    ...(tokens.edge ? { edgeUserAccessToken: tokens.edge } : {}),
    ...(storageUserA ? { storageUserA } : {}),
    ...(storageUserB ? { storageUserB } : {}),
    ...(partitions ? { tenantPartitions: partitions } : {})
  }
}

async function runVerification(): Promise<void> {
  if (!canVerify.value) return
  localError.value = null
  let tokens = readTransientTokens()
  clearTokenInputs()
  try {
    await verification.verify(verificationRequest(tokens, tenantPartitions()))
  } catch {
    localError.value = 'invalid-tenant-partitions'
  } finally {
    tokens = { edge: '', userA: '', userB: '' }
    clearTokenInputs()
  }
}

function gateLabel(status: 'passed' | 'unknown' | 'failed'): string {
  if (status === 'passed') return panels.value.lowcodeSupabaseBackendStagingGatePassed
  if (status === 'failed') return panels.value.lowcodeSupabaseBackendStagingGateFailed
  return panels.value.lowcodeSupabaseBackendStagingGateUnknown
}

watch(busy, (value) => emit('busy', value), { immediate: true })

onScopeDispose(() => {
  emit('busy', false)
  clearTokenInputs()
})
</script>

<template>
  <section
    data-test-id="lowcode-supabase-backend-capability-verification"
    class="mt-1 flex flex-col gap-1.5 rounded border border-border bg-input p-2"
  >
    <div>
      <div class="flex items-center justify-between gap-2">
        <label class="text-[11px] text-muted">
          {{ panels.lowcodeSupabaseBackendCapabilityTitle }}
        </label>
        <span class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase text-amber-500">
          {{ panels.lowcodeSupabaseBackendStagingBadge }}
        </span>
      </div>
      <p class="mt-0.5 text-[10px] text-muted">
        {{ panels.lowcodeSupabaseBackendCapabilityDescription }}
      </p>
      <p class="mt-0.5 text-[10px] text-amber-500">
        {{ panels.lowcodeSupabaseBackendCapabilityTransientNotice }}
      </p>
    </div>

    <label class="flex flex-col gap-1 text-[10px] text-muted">
      {{ panels.lowcodeSupabaseBackendCapabilityEdgeToken }}
      <input
        ref="edgeAccessTokenInput"
        type="password"
        autocomplete="new-password"
        spellcheck="false"
        data-test-id="lowcode-supabase-backend-capability-edge-token"
        :disabled="busy"
        class="w-full rounded border border-border bg-panel px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
      />
    </label>

    <div class="grid grid-cols-2 gap-1">
      <label class="flex flex-col gap-1 text-[10px] text-muted">
        {{ panels.lowcodeSupabaseBackendCapabilityUserAId }}
        <input
          v-model="userAId"
          type="text"
          autocomplete="off"
          spellcheck="false"
          data-test-id="lowcode-supabase-backend-capability-user-a-id"
          :disabled="busy"
          class="min-w-0 rounded border border-border bg-panel px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted">
        {{ panels.lowcodeSupabaseBackendCapabilityUserAToken }}
        <input
          ref="userAAccessTokenInput"
          type="password"
          autocomplete="new-password"
          spellcheck="false"
          data-test-id="lowcode-supabase-backend-capability-user-a-token"
          :disabled="busy"
          class="min-w-0 rounded border border-border bg-panel px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted">
        {{ panels.lowcodeSupabaseBackendCapabilityUserBId }}
        <input
          v-model="userBId"
          type="text"
          autocomplete="off"
          spellcheck="false"
          data-test-id="lowcode-supabase-backend-capability-user-b-id"
          :disabled="busy"
          class="min-w-0 rounded border border-border bg-panel px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
        />
      </label>
      <label class="flex flex-col gap-1 text-[10px] text-muted">
        {{ panels.lowcodeSupabaseBackendCapabilityUserBToken }}
        <input
          ref="userBAccessTokenInput"
          type="password"
          autocomplete="new-password"
          spellcheck="false"
          data-test-id="lowcode-supabase-backend-capability-user-b-token"
          :disabled="busy"
          class="min-w-0 rounded border border-border bg-panel px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
        />
      </label>
    </div>

    <label class="flex flex-col gap-1 text-[10px] text-muted">
      {{ panels.lowcodeSupabaseBackendCapabilityTenantPartitions }}
      <textarea
        v-model="tenantPartitionsJSON"
        rows="3"
        spellcheck="false"
        data-test-id="lowcode-supabase-backend-capability-tenant-partitions"
        :disabled="busy"
        :placeholder="panels.lowcodeSupabaseBackendCapabilityTenantPlaceholder"
        class="w-full resize-y rounded border border-border bg-panel px-2 py-1 font-mono text-[10px] text-surface outline-none focus:border-accent disabled:opacity-50"
      />
    </label>

    <button
      type="button"
      data-test-id="lowcode-supabase-backend-capability-verify"
      :disabled="!canVerify"
      class="rounded border border-amber-500/50 px-2 py-1 text-[11px] text-amber-500 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
      @click="runVerification"
    >
      {{
        busy
          ? panels.lowcodeSupabaseBackendCapabilityVerifying
          : panels.lowcodeSupabaseBackendCapabilityVerify
      }}
    </button>

    <p
      v-if="errorMessage"
      data-test-id="lowcode-supabase-backend-capability-error"
      class="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
    >
      {{ errorMessage }}
    </p>

    <article
      v-if="verification.result.value"
      data-test-id="lowcode-supabase-backend-capability-receipt"
      class="flex flex-col gap-1.5 rounded border border-border bg-panel p-2"
    >
      <p
        :class="[
          'text-[10px]',
          verification.result.value.receipt.outcome === 'succeeded'
            ? 'text-green-500'
            : 'text-amber-500'
        ]"
      >
        {{ outcomeLabel }}
      </p>
      <p
        v-if="verification.result.value.receipt.outcome === 'outcome-unknown'"
        class="text-[10px] text-amber-500"
      >
        {{ panels.lowcodeSupabaseBackendStagingNoRetry }}
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[9px] text-muted">
        <dt>{{ panels.lowcodeSupabaseBackendStagingReceiptId }}</dt>
        <dd class="min-w-0 break-all font-mono text-surface">
          {{ verification.result.value.receipt.verificationId }}
        </dd>
        <dt>{{ panels.lowcodeSupabaseBackendCapabilityReceiptDigest }}</dt>
        <dd class="min-w-0 break-all font-mono text-surface">
          {{ verification.result.value.receiptDigest }}
        </dd>
        <template v-if="verification.result.value.receipt.edgeFunctionReceipt">
          <dt>{{ panels.lowcodeSupabaseBackendCapabilityEdgeVersion }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{
              verification.result.value.receipt.edgeFunctionReceipt.remote.versionId ??
              panels.lowcodeSupabaseBackendStagingNotVerified
            }}
          </dd>
        </template>
        <dt>{{ panels.lowcodeSupabaseBackendCapabilityStorageReceipts }}</dt>
        <dd class="font-mono text-surface">
          {{ verification.result.value.receipt.storageIsolationReceipts.length }}
        </dd>
      </dl>
      <ul class="flex flex-col gap-0.5 text-[9px] text-muted">
        <li
          v-for="gate in verification.result.value.receipt.gates"
          :key="gate.gate"
          class="flex items-start justify-between gap-2"
        >
          <code class="min-w-0 break-all">{{ gate.gate }}</code>
          <span
            :class="[
              'shrink-0',
              gate.status === 'passed'
                ? 'text-green-500'
                : gate.status === 'failed'
                  ? 'text-red-500'
                  : 'text-amber-500'
            ]"
          >
            {{ gateLabel(gate.status) }}
          </span>
        </li>
      </ul>
      <p class="text-[10px] text-amber-500">
        {{ panels.lowcodeSupabaseBackendStagingProductionBlocked }}
      </p>
    </article>
  </section>
</template>
