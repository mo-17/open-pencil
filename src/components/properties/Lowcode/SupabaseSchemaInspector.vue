<script setup lang="ts">
import { computed, onScopeDispose, ref, toRef, watch } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useSupabaseSchemaInspector } from '@/app/lowcode/supabase/schema-inspector'
import { useSupabaseBackendProviderReview } from '@/app/lowcode/supabase/backend/provider-review'
import { useSupabaseBackendProviderStagingRelease } from '@/app/lowcode/supabase/backend/provider-staging-release'
import type {
  SupabaseSchemaRelation,
  SupabaseSchemaTable
} from '@/app/lowcode/supabase/schema-catalog'
import { useSupabaseStagingReleaseAuthority } from '@/app/lowcode/supabase/staging-release-authority'
import { useSupabaseStagedMigrationPlan } from '@/app/lowcode/supabase/staged-migration-plan'
import { getActiveEditorStore, useEditorStore } from '@/app/editor/active-store'
import { isTauri } from '@/app/tauri/env'
import type { DesktopSupabaseBackendTarget } from '@/app/plugins/host/deployment/desktop/supabase/backend/target'
import AppSelect from '@/components/ui/AppSelect.vue'

import SupabaseBackendStagingVerification from './SupabaseBackendStagingVerification.vue'
import SupabaseSourceMigrationExport from './SupabaseSourceMigrationExport.vue'

const { config } = defineProps<{ config?: SupabaseConfig }>()
const { panels } = useI18n()
const configRef = toRef(() => config)
const inspector = useSupabaseSchemaInspector(configRef)
const editor = useEditorStore()
const backendReviewTarget = ref<DesktopSupabaseBackendTarget>('react')
const backendReview = useSupabaseBackendProviderReview(configRef, () => editor.graph, {
  readTarget: () => backendReviewTarget.value
})
const backendTargetOptions: { value: DesktopSupabaseBackendTarget; label: string }[] = [
  { value: 'react', label: 'React' },
  { value: 'vue', label: 'Vue' }
]
const stagingAuthority = useSupabaseStagingReleaseAuthority()
const stagingRelease = useSupabaseBackendProviderStagingRelease(
  configRef,
  backendReview.result,
  () => editor.graph,
  {
    readContext() {
      const contextEditor = getActiveEditorStore()
      return {
        identity: contextEditor,
        readGraph: () => contextEditor.graph,
        readConfig: () =>
          contextEditor.graph.getNode(contextEditor.graph.rootId)?.lowcodeSupabaseConfig
      }
    }
  }
)
const stagedMigrationPlan = useSupabaseStagedMigrationPlan(() => {
  backendReview.reset()
  stagingRelease.reset()
  stagingProjectRefConfirmation.value = ''
  stagingIndependentConfirmed.value = false
})
const backendReviewAvailable = isTauri()
const patInput = ref<HTMLInputElement>()
const stagingWritePatInput = ref<HTMLInputElement>()
const stagingProjectRefConfirmation = ref('')
const stagingIndependentConfirmed = ref(false)
const capabilityVerificationBusy = ref(false)
const sourceMigrationExportBusy = ref(false)
const expandedTables = ref<ReadonlySet<string>>(new Set())
const copiedIdentifier = ref('')
const copyFailed = ref(false)
const reviewSqlCopyState = ref<'idle' | 'copied' | 'error'>('idle')
let copiedTimer: ReturnType<typeof setTimeout> | undefined
let reviewSqlCopiedTimer: ReturnType<typeof setTimeout> | undefined

const stagingIdentity = computed(() => {
  const reviewed = backendReview.result.value
  return reviewed ? { projectRef: reviewed.projectRef, accountId: reviewed.accountId } : null
})

const stagingTargetMatches = computed(() => {
  const identity = stagingIdentity.value
  return identity ? stagingAuthority.targetMatches(identity) : false
})

const sourceMigrationExternalBusy = computed(
  () =>
    backendReview.state.value === 'loading' ||
    inspector.credentialBusy.value ||
    inspector.requestState.value === 'loading' ||
    stagingAuthority.credentialBusy.value ||
    stagingAuthority.targetBusy.value ||
    stagingRelease.state.value === 'loading' ||
    capabilityVerificationBusy.value ||
    stagedMigrationPlan.busy.value
)
const stagingBusy = computed(
  () => sourceMigrationExternalBusy.value || sourceMigrationExportBusy.value
)
const backendTargetControl = computed({
  get: () => backendReviewTarget.value,
  set: (target: DesktopSupabaseBackendTarget) => {
    if (!stagingBusy.value) backendReviewTarget.value = target
  }
})

const stagingCanBind = computed(() => {
  const identity = stagingIdentity.value
  return (
    !!identity &&
    !stagingBusy.value &&
    stagingProjectRefConfirmation.value === identity.projectRef &&
    stagingIndependentConfirmed.value
  )
})

const stagingCanApply = computed(() => {
  const reviewed = backendReview.result.value
  return (
    backendReviewAvailable &&
    !!reviewed?.reviewReady &&
    reviewed.blockerCount === 0 &&
    inspector.credentialStatus.value === 'configured' &&
    stagingAuthority.credentialStatus.value === 'configured' &&
    stagingTargetMatches.value &&
    stagingProjectRefConfirmation.value === reviewed.projectRef &&
    stagingIndependentConfirmed.value &&
    !stagingBusy.value &&
    !stagingRelease.result.value &&
    stagingRelease.state.value !== 'outcome-unknown'
  )
})

const stagingSectionVisible = computed(
  () =>
    !!backendReview.result.value ||
    !!stagingRelease.result.value ||
    stagingRelease.state.value === 'outcome-unknown' ||
    (stagingRelease.state.value === 'loading' && stagingRelease.dispatched.value)
)

const stagingWriteCredentialStatusLabel = computed(() => {
  if (stagingAuthority.credentialStatus.value === 'loading') {
    return panels.value.lowcodeSupabaseBackendStagingWriteCredentialLoading
  }
  if (stagingAuthority.credentialStatus.value === 'configured') {
    return panels.value.lowcodeSupabaseBackendStagingWriteCredentialConfigured
  }
  if (stagingAuthority.credentialStatus.value === 'locked') {
    return panels.value.lowcodeSupabaseBackendStagingWriteCredentialLocked
  }
  if (stagingAuthority.credentialStatus.value === 'unavailable') {
    return panels.value.lowcodeSupabaseBackendStagingWriteCredentialUnavailable
  }
  return panels.value.lowcodeSupabaseBackendStagingWriteCredentialMissing
})

const stagingTargetStatusLabel = computed(() => {
  if (stagingAuthority.targetError.value) {
    return panels.value.lowcodeSupabaseBackendStagingTargetError
  }
  if (stagingTargetMatches.value) return panels.value.lowcodeSupabaseBackendStagingTargetBound
  if (stagingAuthority.target.value) {
    return panels.value.lowcodeSupabaseBackendStagingTargetMismatch
  }
  return panels.value.lowcodeSupabaseBackendStagingTargetMissing
})

const stagingReleaseErrorMessage = computed(() => {
  const code = stagingRelease.error.value
  if (code === 'desktop-required') return panels.value.lowcodeSupabaseBackendStagingDesktopOnly
  if (code === 'binding-mismatch' || code === 'binding-unavailable') {
    return panels.value.lowcodeSupabaseBackendStagingBindingError
  }
  if (code === 'write-credential-missing') {
    return panels.value.lowcodeSupabaseBackendStagingWriteCredentialMissing
  }
  if (code === 'write-credential-not-independent') {
    return panels.value.lowcodeSupabaseBackendStagingWriteCredentialNotIndependent
  }
  if (code === 'credential-missing' || code === 'grant-unavailable' || code === 'grant-changed') {
    return panels.value.lowcodeSupabaseBackendStagingCredentialError
  }
  if (code === 'backend-provider-missing' || code === 'backend-provider-unavailable') {
    return panels.value.lowcodeSupabaseBackendStagingProviderError
  }
  if (code === 'review-stale' || code === 'invalid-config') {
    return panels.value.lowcodeSupabaseBackendStagingReviewStale
  }
  if (code === 'outcome-unknown') {
    return panels.value.lowcodeSupabaseBackendStagingOutcomeUnknown
  }
  return code ? panels.value.lowcodeSupabaseBackendStagingFailed : ''
})

const stagingOutcomeLabel = computed(() => {
  const outcome = stagingRelease.result.value?.outcome
  if (outcome === 'succeeded') return panels.value.lowcodeSupabaseBackendStagingSucceeded
  if (outcome === 'blocked') return panels.value.lowcodeSupabaseBackendStagingBlocked
  if (outcome === 'failed' || outcome === 'cancelled') {
    return panels.value.lowcodeSupabaseBackendStagingFailed
  }
  if (outcome === 'outcome-unknown') {
    return panels.value.lowcodeSupabaseBackendStagingOutcomeUnknown
  }
  return ''
})

const credentialStatusLabel = computed(() => {
  if (inspector.credentialStatus.value === 'loading') {
    return panels.value.lowcodeSupabaseSchemaCredentialLoading
  }
  if (inspector.credentialStatus.value === 'configured') {
    return panels.value.lowcodeSupabaseSchemaCredentialConfigured
  }
  if (inspector.credentialStatus.value === 'locked') {
    return panels.value.lowcodeSupabaseSchemaCredentialLocked
  }
  if (inspector.credentialStatus.value === 'unavailable') {
    return panels.value.lowcodeSupabaseSchemaCredentialUnavailable
  }
  return panels.value.lowcodeSupabaseSchemaCredentialMissing
})

const inspectionMessage = computed(() => {
  const currentError = inspector.error.value
  if (currentError === 'invalid-config' || currentError === 'invalid-project-url') {
    return panels.value.lowcodeSupabaseSchemaInvalidConfig
  }
  if (
    currentError === 'missing-credential' ||
    inspector.requestState.value === 'missing-credential'
  ) {
    return panels.value.lowcodeSupabaseSchemaMissingCredential
  }
  if (
    currentError === 'unauthorized' ||
    currentError === 'forbidden' ||
    currentError === 'not-found'
  ) {
    return panels.value.lowcodeSupabaseSchemaPermissionError
  }
  if (currentError === 'rate-limited') return panels.value.lowcodeSupabaseSchemaRateLimited
  if (currentError === 'timeout') return panels.value.lowcodeSupabaseSchemaTimeout
  if (currentError === 'response-too-large') {
    return panels.value.lowcodeSupabaseSchemaResponseTooLarge
  }
  if (currentError === 'invalid-response' || currentError === 'invalid-openapi') {
    return panels.value.lowcodeSupabaseSchemaInvalidResponse
  }
  if (currentError === 'cache-write') return panels.value.lowcodeSupabaseSchemaCacheWriteFailed
  if (currentError) return panels.value.lowcodeSupabaseSchemaInspectFailed
  if (inspector.cacheState.value === 'loading')
    return panels.value.lowcodeSupabaseSchemaCacheLoading
  if (inspector.cacheState.value === 'expired')
    return panels.value.lowcodeSupabaseSchemaCacheExpired
  if (inspector.cacheState.value === 'invalid')
    return panels.value.lowcodeSupabaseSchemaCacheInvalid
  if (inspector.cacheState.value === 'miss' && !inspector.catalog.value) {
    return panels.value.lowcodeSupabaseSchemaCacheEmpty
  }
  return ''
})

const messageTone = computed(() => {
  if (inspector.error.value === 'cache-write') return 'warning'
  if (inspector.error.value) return 'error'
  return 'muted'
})

const backendReviewErrorMessage = computed(() => {
  const code = backendReview.error.value
  if (code === 'desktop-required') return panels.value.lowcodeSupabaseBackendReviewDesktopOnly
  if (code === 'invalid-config') return panels.value.lowcodeSupabaseBackendReviewInvalidConfig
  if (code === 'invalid-target') return panels.value.lowcodeSupabaseBackendReviewInvalidTarget
  if (code === 'credential-missing' || code === 'grant-unavailable' || code === 'grant-changed') {
    return panels.value.lowcodeSupabaseBackendReviewCredentialError
  }
  if (code === 'backend-provider-missing') {
    return panels.value.lowcodeSupabaseBackendReviewProviderMissing
  }
  if (code === 'backend-provider-unavailable') {
    return panels.value.lowcodeSupabaseBackendReviewProviderUnavailable
  }
  if (code === 'review-stale') return panels.value.lowcodeSupabaseBackendReviewStale
  if (code === 'staged-plan-invalid') {
    return panels.value.lowcodeSupabaseBackendStagedPlanErrorInvalid
  }
  return code ? panels.value.lowcodeSupabaseBackendReviewFailed : ''
})

const stagedPlanErrorMessage = computed(() => {
  if (stagedMigrationPlan.error.value === 'invalid-file') {
    return panels.value.lowcodeSupabaseBackendStagedPlanErrorFile
  }
  if (stagedMigrationPlan.error.value === 'plan-too-large') {
    return panels.value.lowcodeSupabaseBackendStagedPlanErrorTooLarge
  }
  if (stagedMigrationPlan.error.value === 'invalid-plan') {
    return panels.value.lowcodeSupabaseBackendStagedPlanErrorInvalid
  }
  return ''
})

function toggleTable(tableName: string): void {
  const next = new Set(expandedTables.value)
  if (next.has(tableName)) next.delete(tableName)
  else next.add(tableName)
  expandedTables.value = next
}

function relationLabel(relation: SupabaseSchemaRelation): string {
  return relation.targetColumn
    ? `${relation.targetTable}.${relation.targetColumn}`
    : relation.targetTable
}

function columnRelations(table: SupabaseSchemaTable, columnName: string) {
  return table.relations.filter((relation) => relation.sourceColumn === columnName)
}

async function savePat(): Promise<void> {
  const input = patInput.value
  if (!input || stagingBusy.value) return
  let personalAccessToken = input.value
  input.value = ''
  try {
    await inspector.saveCredential(personalAccessToken)
  } finally {
    personalAccessToken = ''
    input.value = ''
  }
}

async function clearPat(): Promise<void> {
  if (stagingBusy.value) return
  if (patInput.value) patInput.value.value = ''
  await inspector.clearCredential()
}

async function saveStagingWritePat(): Promise<void> {
  const input = stagingWritePatInput.value
  if (!input || stagingBusy.value) return
  let personalAccessToken = input.value
  input.value = ''
  try {
    await stagingAuthority.saveCredential(personalAccessToken)
  } finally {
    personalAccessToken = ''
    input.value = ''
  }
}

async function clearStagingWritePat(): Promise<void> {
  if (stagingBusy.value) return
  if (stagingWritePatInput.value) stagingWritePatInput.value.value = ''
  await stagingAuthority.clearCredential()
}

function bindStagingTarget(): void {
  const identity = stagingIdentity.value
  if (!identity || !stagingCanBind.value) return
  stagingAuthority.bindTarget(
    identity,
    stagingProjectRefConfirmation.value,
    stagingIndependentConfirmed.value
  )
}

function clearStagingTarget(): void {
  if (stagingBusy.value) return
  stagingAuthority.clearTarget()
  stagingProjectRefConfirmation.value = ''
  stagingIndependentConfirmed.value = false
}

async function runStagingRelease(): Promise<void> {
  if (!stagingCanApply.value) return
  await stagingRelease.release(
    stagingProjectRefConfirmation.value,
    stagingIndependentConfirmed.value
  )
}

async function runBackendReview(): Promise<void> {
  if (stagingBusy.value) return
  await backendReview.review(stagedMigrationPlan.plan.value ?? undefined)
}

function stagingGateStatusLabel(status: 'passed' | 'unknown' | 'failed'): string {
  if (status === 'passed') return panels.value.lowcodeSupabaseBackendStagingGatePassed
  if (status === 'failed') return panels.value.lowcodeSupabaseBackendStagingGateFailed
  return panels.value.lowcodeSupabaseBackendStagingGateUnknown
}

async function copyName(key: string, value: string): Promise<void> {
  copyFailed.value = false
  try {
    await navigator.clipboard.writeText(value)
    copiedIdentifier.value = key
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      if (copiedIdentifier.value === key) copiedIdentifier.value = ''
    }, 1500)
  } catch {
    copiedIdentifier.value = ''
    copyFailed.value = true
  }
}

function resetReviewSqlCopyState(): void {
  if (reviewSqlCopiedTimer) {
    clearTimeout(reviewSqlCopiedTimer)
    reviewSqlCopiedTimer = undefined
  }
  reviewSqlCopyState.value = 'idle'
}

async function copyReviewSql(): Promise<void> {
  const sql = backendReview.result.value?.artifact.inspectedReview.sql
  if (!sql) return
  resetReviewSqlCopyState()
  try {
    await navigator.clipboard.writeText(sql)
    reviewSqlCopyState.value = 'copied'
    reviewSqlCopiedTimer = setTimeout(() => {
      reviewSqlCopyState.value = 'idle'
      reviewSqlCopiedTimer = undefined
    }, 1500)
  } catch {
    reviewSqlCopyState.value = 'error'
  }
}

watch(
  () => getActiveEditorStore(),
  () => {
    backendReview.reset()
    stagingProjectRefConfirmation.value = ''
    stagingIndependentConfirmed.value = false
  },
  { flush: 'sync' }
)

watch(
  backendReviewTarget,
  () => {
    stagingRelease.reset()
    stagingProjectRefConfirmation.value = ''
    stagingIndependentConfirmed.value = false
  },
  { flush: 'sync' }
)

watch(
  () => backendReview.state.value,
  (state) => {
    if (state === 'idle' || state === 'loading') resetReviewSqlCopyState()
    if (state === 'loading') {
      stagingRelease.reset()
      stagingProjectRefConfirmation.value = ''
      stagingIndependentConfirmed.value = false
    }
  }
)

watch(
  () => [
    backendReview.result.value?.projectRef,
    backendReview.result.value?.accountId,
    backendReview.result.value?.documentDigest
  ],
  () => {
    stagingAuthority.refreshTarget()
  }
)

onScopeDispose(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
  resetReviewSqlCopyState()
  if (patInput.value) patInput.value.value = ''
  if (stagingWritePatInput.value) stagingWritePatInput.value.value = ''
})
</script>

<template>
  <section
    data-test-id="lowcode-supabase-schema-inspector"
    class="mt-2 flex flex-col gap-1.5 border-t border-border pt-2"
  >
    <div>
      <div class="flex items-center justify-between gap-2">
        <label class="text-[11px] text-muted">{{ panels.lowcodeSupabaseSchemaInspector }}</label>
        <span
          v-if="inspector.source.value"
          data-test-id="lowcode-supabase-schema-source"
          class="rounded bg-hover px-1.5 py-0.5 text-[9px] uppercase text-muted"
        >
          {{
            inspector.source.value === 'cached'
              ? panels.lowcodeSupabaseSchemaCached
              : panels.lowcodeSupabaseSchemaLive
          }}
        </span>
      </div>
      <p class="mt-0.5 text-[10px] text-muted">
        {{ panels.lowcodeSupabaseSchemaInspectorDescription }}
      </p>
    </div>

    <label for="supabase-management-pat" class="text-[10px] text-muted">
      {{ panels.lowcodeSupabaseSchemaPat }}
    </label>
    <div class="flex gap-1">
      <input
        id="supabase-management-pat"
        ref="patInput"
        type="password"
        autocomplete="new-password"
        spellcheck="false"
        data-test-id="lowcode-supabase-schema-pat"
        :placeholder="
          inspector.credentialStatus.value === 'configured'
            ? panels.lowcodeSupabaseSchemaPatConfiguredPlaceholder
            : panels.lowcodeSupabaseSchemaPatPlaceholder
        "
        class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent"
        @keyup.enter="savePat"
      />
      <button
        type="button"
        data-test-id="lowcode-supabase-schema-pat-save"
        :disabled="stagingBusy"
        class="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
        @click="savePat"
      >
        {{ panels.lowcodeSupabaseSchemaSavePat }}
      </button>
      <button
        v-if="inspector.credentialStatus.value === 'configured'"
        type="button"
        data-test-id="lowcode-supabase-schema-pat-clear"
        :disabled="stagingBusy"
        class="rounded px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
        @click="clearPat"
      >
        {{ panels.lowcodeSupabaseSchemaClearPat }}
      </button>
    </div>
    <p
      data-test-id="lowcode-supabase-schema-credential-status"
      :class="['text-[10px]', inspector.credentialError.value ? 'text-red-500' : 'text-muted']"
    >
      {{
        inspector.credentialError.value
          ? panels.lowcodeSupabaseSchemaCredentialError
          : credentialStatusLabel
      }}
    </p>

    <button
      type="button"
      data-test-id="lowcode-supabase-schema-inspect"
      :disabled="stagingBusy"
      class="rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
      @click="inspector.inspect"
    >
      {{
        inspector.requestState.value === 'loading'
          ? panels.lowcodeSupabaseSchemaInspecting
          : panels.lowcodeSupabaseSchemaInspect
      }}
    </button>

    <p
      v-if="inspectionMessage"
      data-test-id="lowcode-supabase-schema-message"
      :class="[
        'rounded border px-2 py-1 text-[10px]',
        messageTone === 'error' && 'border-red-500/40 bg-red-500/10 text-red-500',
        messageTone === 'warning' && 'border-amber-500/40 bg-amber-500/10 text-amber-500',
        messageTone === 'muted' && 'border-border bg-input text-muted'
      ]"
    >
      {{ inspectionMessage }}
    </p>
    <p
      v-if="copyFailed"
      data-test-id="lowcode-supabase-schema-copy-error"
      class="text-[10px] text-red-500"
    >
      {{ panels.lowcodeSupabaseSchemaCopyFailed }}
    </p>

    <div
      v-if="inspector.catalog.value"
      data-test-id="lowcode-supabase-schema-catalog"
      class="flex flex-col gap-1"
    >
      <p class="text-[10px] text-muted">
        {{ inspector.catalog.value.tables.length }} {{ panels.lowcodeSupabaseSchemaTables }}
      </p>
      <p
        v-if="inspector.catalog.value.tables.length === 0"
        data-test-id="lowcode-supabase-schema-no-tables"
        class="rounded border border-border bg-input px-2 py-1 text-[10px] text-muted"
      >
        {{ panels.lowcodeSupabaseSchemaNoTables }}
      </p>
      <article
        v-for="table in inspector.catalog.value.tables"
        :key="table.name"
        data-test-id="lowcode-supabase-schema-table"
        class="rounded border border-border bg-input"
      >
        <div class="flex items-center gap-1 px-1.5 py-1">
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-surface"
            :aria-expanded="expandedTables.has(table.name)"
            @click="toggleTable(table.name)"
          >
            {{ expandedTables.has(table.name) ? '▾' : '▸' }} {{ table.name }}
          </button>
          <button
            type="button"
            :data-copy-table="table.name"
            class="rounded px-1 text-[9px] text-muted hover:bg-hover hover:text-surface"
            @click="copyName(`table:${table.name}`, table.name)"
          >
            {{
              copiedIdentifier === `table:${table.name}`
                ? panels.lowcodeSupabaseSchemaCopied
                : panels.lowcodeSupabaseSchemaCopyName
            }}
          </button>
        </div>

        <div v-if="expandedTables.has(table.name)" class="flex flex-col border-t border-border">
          <p v-if="table.description" class="px-2 py-1 text-[10px] text-muted">
            {{ table.description }}
          </p>
          <div
            v-for="column in table.columns"
            :key="column.name"
            data-test-id="lowcode-supabase-schema-column"
            class="border-t border-border px-2 py-1 first:border-t-0"
          >
            <div class="flex items-start gap-1">
              <code class="min-w-0 flex-1 break-all text-[10px] text-surface">{{
                column.name
              }}</code>
              <button
                type="button"
                :data-copy-column="`${table.name}.${column.name}`"
                class="shrink-0 rounded px-1 text-[9px] text-muted hover:bg-hover hover:text-surface"
                @click="copyName(`column:${table.name}.${column.name}`, column.name)"
              >
                {{
                  copiedIdentifier === `column:${table.name}.${column.name}`
                    ? panels.lowcodeSupabaseSchemaCopied
                    : panels.lowcodeSupabaseSchemaCopyName
                }}
              </button>
            </div>
            <div class="mt-0.5 flex flex-wrap gap-1 text-[9px] text-muted">
              <span class="rounded bg-hover px-1 font-mono">{{ column.type }}</span>
              <span class="rounded bg-hover px-1">
                {{
                  column.required
                    ? panels.lowcodeSupabaseSchemaRequired
                    : panels.lowcodeSupabaseSchemaOptional
                }}
              </span>
              <span class="rounded bg-hover px-1">
                {{
                  column.nullable
                    ? panels.lowcodeSupabaseSchemaNullable
                    : panels.lowcodeSupabaseSchemaNotNull
                }}
              </span>
              <span
                v-for="relation in columnRelations(table, column.name)"
                :key="relationLabel(relation)"
                class="rounded bg-accent/10 px-1 text-accent"
              >
                {{ panels.lowcodeSupabaseSchemaRelation }} → {{ relationLabel(relation) }}
              </span>
            </div>
            <p v-if="column.description" class="mt-0.5 text-[9px] text-muted">
              {{ column.description }}
            </p>
          </div>
        </div>
      </article>
    </div>

    <div
      data-test-id="lowcode-supabase-backend-review"
      class="mt-1 flex flex-col gap-1.5 border-t border-border pt-2"
    >
      <div>
        <label class="text-[11px] text-muted">{{ panels.lowcodeSupabaseBackendReview }}</label>
        <p class="mt-0.5 text-[10px] text-muted">
          {{ panels.lowcodeSupabaseBackendReviewDescription }}
        </p>
        <p class="mt-0.5 text-[10px] text-amber-500">
          {{ panels.lowcodeSupabaseBackendReviewOnly }}
        </p>
      </div>

      <div class="flex items-center justify-between gap-2">
        <label class="text-[10px] text-muted">
          {{ panels.lowcodeSupabaseBackendReviewTarget }}
        </label>
        <AppSelect
          v-model="backendTargetControl"
          :options="backendTargetOptions"
          :label="panels.lowcodeSupabaseBackendReviewTarget"
          :disabled="stagingBusy"
          data-property="backend-review-target"
        />
      </div>

      <p
        v-if="!backendReviewAvailable"
        data-test-id="lowcode-supabase-backend-review-desktop-only"
        class="rounded border border-border bg-input px-2 py-1 text-[10px] text-muted"
      >
        {{ panels.lowcodeSupabaseBackendReviewDesktopOnly }}
      </p>
      <div
        data-test-id="lowcode-supabase-backend-staged-plan"
        class="rounded border border-border bg-input/60 p-2"
      >
        <div class="flex items-center justify-between gap-2">
          <label class="text-[10px] text-muted">
            {{ panels.lowcodeSupabaseBackendStagedPlanTitle }}
          </label>
          <button
            v-if="stagedMigrationPlan.plan.value"
            type="button"
            data-test-id="lowcode-supabase-backend-staged-plan-clear"
            :disabled="stagingBusy"
            class="rounded px-1 text-[9px] text-muted hover:bg-hover disabled:opacity-50"
            @click="stagedMigrationPlan.clear"
          >
            {{ panels.lowcodeSupabaseBackendStagedPlanClear }}
          </button>
        </div>
        <p class="mt-0.5 text-[9px] leading-relaxed text-muted">
          {{ panels.lowcodeSupabaseBackendStagedPlanDescription }}
        </p>
        <label
          class="mt-1 block cursor-pointer rounded border border-border px-2 py-1 text-center text-[10px] text-muted hover:bg-hover hover:text-surface"
          :class="stagingBusy ? 'pointer-events-none opacity-50' : ''"
        >
          {{ panels.lowcodeSupabaseBackendStagedPlanChoose }}
          <input
            :ref="stagedMigrationPlan.setInput"
            type="file"
            accept=".json,application/json"
            class="hidden"
            data-test-id="lowcode-supabase-backend-staged-plan-file"
            :disabled="stagingBusy"
            @change="stagedMigrationPlan.select"
          />
        </label>
        <dl
          v-if="stagedMigrationPlan.plan.value"
          data-test-id="lowcode-supabase-backend-staged-plan-summary"
          class="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[9px] text-muted"
        >
          <dt>{{ panels.lowcodeSupabaseBackendStagedPlanFile }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{ stagedMigrationPlan.fileName.value }}
          </dd>
          <dt>{{ panels.lowcodeSupabaseBackendStagedPlanPhase }}</dt>
          <dd class="font-mono text-surface">{{ stagedMigrationPlan.plan.value.phase }}</dd>
          <dt>{{ panels.lowcodeSupabaseBackendStagedPlanOperations }}</dt>
          <dd class="font-mono text-surface">
            {{ stagedMigrationPlan.plan.value.operations.length }}
          </dd>
          <dt>{{ panels.lowcodeSupabaseBackendStagedPlanRisk }}</dt>
          <dd class="font-mono text-surface">
            {{ stagedMigrationPlan.plan.value.highestRisk }}
          </dd>
        </dl>
        <p
          v-if="stagedMigrationPlan.plan.value?.requiresHumanApproval"
          class="mt-1 text-[9px] text-red-500"
        >
          {{ panels.lowcodeSupabaseBackendStagedPlanApprovalRequired }}
        </p>
        <p
          v-if="stagedPlanErrorMessage"
          data-test-id="lowcode-supabase-backend-staged-plan-error"
          class="mt-1 text-[9px] text-red-500"
        >
          {{ stagedPlanErrorMessage }}
        </p>
      </div>
      <button
        type="button"
        data-test-id="lowcode-supabase-backend-review-action"
        :disabled="
          !backendReviewAvailable || stagingBusy || stagingRelease.state.value === 'outcome-unknown'
        "
        class="rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
        @click="runBackendReview"
      >
        {{
          backendReview.state.value === 'loading'
            ? panels.lowcodeSupabaseBackendReviewing
            : panels.lowcodeSupabaseBackendReviewAction
        }}
      </button>

      <p
        v-if="backendReviewErrorMessage"
        data-test-id="lowcode-supabase-backend-review-error"
        class="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
      >
        {{ backendReviewErrorMessage }}
      </p>

      <div
        v-if="backendReview.result.value"
        data-test-id="lowcode-supabase-backend-review-artifact"
        class="flex flex-col gap-1.5 rounded border border-border bg-input p-2"
      >
        <div class="flex items-center justify-between gap-2">
          <span
            :class="[
              'text-[10px]',
              backendReview.result.value.reviewReady ? 'text-green-500' : 'text-amber-500'
            ]"
          >
            {{
              backendReview.result.value.reviewReady
                ? panels.lowcodeSupabaseBackendReviewReady
                : panels.lowcodeSupabaseBackendReviewBlocked
            }}
          </span>
          <span class="text-[9px] uppercase text-muted">staging</span>
        </div>
        <p class="text-[10px] text-amber-500">
          {{ panels.lowcodeSupabaseBackendReviewApplyUnavailable }}
        </p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[9px] text-muted">
          <dt>{{ panels.lowcodeSupabaseBackendReviewTarget }}</dt>
          <dd class="text-surface capitalize">
            {{ backendReview.result.value.artifact.manifest.target }}
          </dd>
          <dt>{{ panels.lowcodeSupabaseBackendReviewProject }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{ backendReview.result.value.projectRef }} /
            {{ backendReview.result.value.accountId }}
          </dd>
          <dt>{{ panels.lowcodeSupabaseBackendReviewPlanDigest }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{ backendReview.result.value.artifact.manifest.compiler.planDigest }}
          </dd>
          <dt>{{ panels.lowcodeSupabaseBackendReviewSchemaDigest }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{ backendReview.result.value.artifact.manifest.remoteAuthority.inspectedSchemaDigest }}
          </dd>
        </dl>
        <div v-if="backendReview.result.value.blockerCount > 0">
          <p class="text-[10px] text-amber-500">
            {{ panels.lowcodeSupabaseBackendReviewBlockers }}
          </p>
          <ul class="mt-0.5 flex list-disc flex-col gap-0.5 pl-4 text-[9px] text-muted">
            <li
              v-for="blocker in backendReview.result.value.artifact.inspectedReview.manifest
                .blockers"
              :key="`${blocker.code}:${blocker.path}`"
            >
              <code>{{ blocker.code }}</code> — {{ blocker.path }}
            </li>
          </ul>
        </div>
        <details>
          <summary class="cursor-pointer text-[10px] text-muted">
            {{ panels.lowcodeSupabaseBackendReviewSql }}
          </summary>
          <div class="mt-1 flex justify-end">
            <button
              type="button"
              data-test-id="lowcode-supabase-backend-review-copy-sql"
              class="rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
              @click="copyReviewSql"
            >
              {{
                reviewSqlCopyState === 'copied'
                  ? panels.lowcodeSupabaseBackendReviewCopied
                  : panels.lowcodeSupabaseBackendReviewCopySql
              }}
            </button>
          </div>
          <p
            v-if="reviewSqlCopyState === 'error'"
            data-test-id="lowcode-supabase-backend-review-copy-error"
            class="mt-1 text-[10px] text-red-500"
          >
            {{ panels.lowcodeSupabaseBackendReviewCopyFailed }}
          </p>
          <pre
            data-test-id="lowcode-supabase-backend-review-sql"
            class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-panel p-1.5 font-mono text-[9px] text-surface"
            >{{ backendReview.result.value.artifact.inspectedReview.sql }}</pre
          >
        </details>
        <SupabaseSourceMigrationExport
          :config="config"
          :graph="editor.graph"
          :reviewed="backendReview.result.value"
          :external-busy="sourceMigrationExternalBusy"
          @busy="sourceMigrationExportBusy = $event"
        />
      </div>
    </div>

    <div
      v-if="stagingSectionVisible"
      data-test-id="lowcode-supabase-backend-staging-release"
      class="mt-1 flex flex-col gap-1.5 border-t border-border pt-2"
    >
      <div>
        <div class="flex items-center justify-between gap-2">
          <label class="text-[11px] text-muted">
            {{ panels.lowcodeSupabaseBackendStagingTitle }}
          </label>
          <span class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase text-amber-500">
            {{ panels.lowcodeSupabaseBackendStagingBadge }}
          </span>
        </div>
        <p class="mt-0.5 text-[10px] text-muted">
          {{ panels.lowcodeSupabaseBackendStagingDescription }}
        </p>
        <p class="mt-0.5 text-[10px] text-amber-500">
          {{ panels.lowcodeSupabaseBackendStagingProductionBlocked }}
        </p>
        <p class="mt-0.5 text-[10px] text-amber-500">
          {{ panels.lowcodeSupabaseBackendStagingRlsManual }}
        </p>
      </div>

      <p
        v-if="!backendReviewAvailable"
        data-test-id="lowcode-supabase-backend-staging-desktop-only"
        class="rounded border border-border bg-input px-2 py-1 text-[10px] text-muted"
      >
        {{ panels.lowcodeSupabaseBackendStagingDesktopOnly }}
      </p>

      <template v-if="backendReview.result.value">
        <label for="supabase-management-write-pat" class="text-[10px] text-muted">
          {{ panels.lowcodeSupabaseBackendStagingWriteCredential }}
        </label>
        <p class="text-[10px] text-amber-500">
          {{ panels.lowcodeSupabaseBackendStagingWriteCredentialIndependent }}
        </p>
        <div class="flex gap-1">
          <input
            id="supabase-management-write-pat"
            ref="stagingWritePatInput"
            type="password"
            autocomplete="new-password"
            spellcheck="false"
            data-test-id="lowcode-supabase-backend-staging-write-pat"
            :placeholder="
              stagingAuthority.credentialStatus.value === 'configured'
                ? panels.lowcodeSupabaseBackendStagingWriteCredentialConfiguredPlaceholder
                : panels.lowcodeSupabaseBackendStagingWriteCredentialPlaceholder
            "
            :disabled="stagingBusy"
            class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
            @keyup.enter="saveStagingWritePat"
          />
          <button
            type="button"
            data-test-id="lowcode-supabase-backend-staging-write-pat-save"
            :disabled="stagingBusy"
            class="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
            @click="saveStagingWritePat"
          >
            {{ panels.lowcodeSupabaseBackendStagingSaveWriteCredential }}
          </button>
          <button
            v-if="stagingAuthority.credentialStatus.value === 'configured'"
            type="button"
            data-test-id="lowcode-supabase-backend-staging-write-pat-clear"
            :disabled="stagingBusy"
            class="rounded px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
            @click="clearStagingWritePat"
          >
            {{ panels.lowcodeSupabaseBackendStagingClearWriteCredential }}
          </button>
        </div>
        <p
          data-test-id="lowcode-supabase-backend-staging-write-credential-status"
          :class="[
            'text-[10px]',
            stagingAuthority.credentialError.value ? 'text-red-500' : 'text-muted'
          ]"
        >
          {{
            stagingAuthority.credentialError.value
              ? panels.lowcodeSupabaseBackendStagingWriteCredentialError
              : stagingWriteCredentialStatusLabel
          }}
        </p>

        <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[9px] text-muted">
          <dt>{{ panels.lowcodeSupabaseBackendStagingExpectedTarget }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{ backendReview.result.value.projectRef }} / {{ backendReview.result.value.accountId }}
          </dd>
        </dl>
        <label for="supabase-staging-project-confirmation" class="text-[10px] text-muted">
          {{ panels.lowcodeSupabaseBackendStagingProjectConfirmation }}
        </label>
        <input
          id="supabase-staging-project-confirmation"
          v-model="stagingProjectRefConfirmation"
          type="text"
          autocomplete="off"
          spellcheck="false"
          data-test-id="lowcode-supabase-backend-staging-project-confirmation"
          :disabled="stagingBusy"
          :placeholder="backendReview.result.value.projectRef"
          class="w-full rounded border border-border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:opacity-50"
        />
        <label class="flex items-start gap-1.5 text-[10px] text-muted">
          <input
            v-model="stagingIndependentConfirmed"
            type="checkbox"
            data-test-id="lowcode-supabase-backend-staging-independent-confirmation"
            :disabled="stagingBusy"
            class="mt-0.5 size-3.5 shrink-0 accent-accent"
          />
          <span>{{ panels.lowcodeSupabaseBackendStagingIndependentConfirmation }}</span>
        </label>
        <div class="flex gap-1">
          <button
            type="button"
            data-test-id="lowcode-supabase-backend-staging-bind-target"
            :disabled="!stagingCanBind"
            class="flex-1 rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-50"
            @click="bindStagingTarget"
          >
            {{ panels.lowcodeSupabaseBackendStagingBindTarget }}
          </button>
          <button
            v-if="stagingAuthority.target.value"
            type="button"
            data-test-id="lowcode-supabase-backend-staging-clear-target"
            :disabled="stagingBusy"
            class="rounded px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
            @click="clearStagingTarget"
          >
            {{ panels.lowcodeSupabaseBackendStagingClearTarget }}
          </button>
        </div>
        <p
          data-test-id="lowcode-supabase-backend-staging-target-status"
          :class="['text-[10px]', stagingTargetMatches ? 'text-green-500' : 'text-amber-500']"
        >
          {{ stagingTargetStatusLabel }}
        </p>

        <button
          type="button"
          data-test-id="lowcode-supabase-backend-staging-apply"
          :disabled="!stagingCanApply"
          class="rounded border border-amber-500/50 px-2 py-1 text-[11px] text-amber-500 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          @click="runStagingRelease"
        >
          {{
            stagingRelease.state.value === 'loading'
              ? panels.lowcodeSupabaseBackendStagingApplying
              : panels.lowcodeSupabaseBackendStagingApply
          }}
        </button>
      </template>

      <dl
        v-if="stagingRelease.target.value"
        data-test-id="lowcode-supabase-backend-staging-operation-target"
        class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[9px] text-muted"
      >
        <dt>{{ panels.lowcodeSupabaseBackendStagingExpectedTarget }}</dt>
        <dd class="min-w-0 break-all font-mono text-surface">
          {{ stagingRelease.target.value.projectRef }} / {{ stagingRelease.target.value.accountId }}
        </dd>
      </dl>
      <p
        v-if="stagingRelease.state.value === 'loading'"
        data-test-id="lowcode-supabase-backend-staging-settling"
        class="text-[10px] text-amber-500"
      >
        {{ panels.lowcodeSupabaseBackendStagingApplying }}
      </p>
      <p
        v-if="stagingRelease.state.value === 'outcome-unknown'"
        data-test-id="lowcode-supabase-backend-staging-no-retry"
        class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500"
      >
        {{ panels.lowcodeSupabaseBackendStagingNoRetry }}
      </p>

      <p
        v-if="stagingReleaseErrorMessage"
        data-test-id="lowcode-supabase-backend-staging-error"
        class="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
      >
        {{ stagingReleaseErrorMessage }}
      </p>

      <article
        v-if="stagingRelease.result.value"
        data-test-id="lowcode-supabase-backend-staging-receipt"
        class="flex flex-col gap-1.5 rounded border border-border bg-input p-2"
      >
        <p
          :class="[
            'text-[10px]',
            stagingRelease.result.value.outcome === 'succeeded'
              ? 'text-green-500'
              : 'text-amber-500'
          ]"
        >
          {{ stagingOutcomeLabel }}
        </p>
        <p class="text-[10px] text-amber-500">
          {{ panels.lowcodeSupabaseBackendStagingProductionBlocked }}
        </p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[9px] text-muted">
          <dt>{{ panels.lowcodeSupabaseBackendStagingReceiptId }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{ stagingRelease.result.value.receipt.receiptId }}
          </dd>
          <dt>{{ panels.lowcodeSupabaseBackendReviewPlanDigest }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{ stagingRelease.result.value.receipt.planDigest }}
          </dd>
          <dt>{{ panels.lowcodeSupabaseBackendStagingVerifiedAt }}</dt>
          <dd class="min-w-0 break-all font-mono text-surface">
            {{
              stagingRelease.result.value.receipt.verifiedAt ??
              panels.lowcodeSupabaseBackendStagingNotVerified
            }}
          </dd>
          <template v-if="stagingRelease.result.value.receipt.failure">
            <dt>{{ panels.lowcodeSupabaseBackendStagingFailure }}</dt>
            <dd class="min-w-0 break-all font-mono text-red-500">
              {{ stagingRelease.result.value.receipt.failure.code }}
            </dd>
          </template>
        </dl>
        <div>
          <p class="text-[10px] text-muted">
            {{ panels.lowcodeSupabaseBackendStagingVerificationGates }}
          </p>
          <ul class="mt-0.5 flex flex-col gap-0.5 text-[9px] text-muted">
            <li
              v-for="gate in stagingRelease.result.value.receipt.gates"
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
                {{ stagingGateStatusLabel(gate.status) }}
              </span>
            </li>
          </ul>
        </div>
      </article>

      <SupabaseBackendStagingVerification
        v-if="backendReview.result.value"
        :config="config"
        :reviewed="backendReview.result.value"
        :project-ref-confirmation="stagingProjectRefConfirmation"
        :confirmed-independent-staging="stagingIndependentConfirmed"
        :disabled="
          !backendReviewAvailable ||
          !stagingTargetMatches ||
          stagingRelease.state.value === 'loading' ||
          stagingRelease.state.value === 'outcome-unknown'
        "
        @busy="capabilityVerificationBusy = $event"
      />
    </div>
  </section>
</template>
