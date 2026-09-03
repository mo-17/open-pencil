<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  BACKEND_LIMITS,
  type BackendApplicationSpecV1,
  type BackendStorageBucketIR,
  type BackendStorageOperation,
  type BackendStoragePathRuleIR,
  type BackendStoragePrincipalIntent
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import {
  BackendDraftOperationError,
  addBackendStorageBucket,
  addBackendStoragePathRule,
  backendStorageTenantOptions,
  setBackendStoragePathRulePrincipal
} from '../draft'

const { application } = defineProps<{ application: BackendApplicationSpecV1 }>()
const { panels } = useI18n()
const operationError = ref('')
const armedRemoval = ref('')
const operations = Object.freeze([
  'read',
  'create',
  'update',
  'delete',
  'upsert'
] as const satisfies readonly BackendStorageOperation[])
const buckets = computed(() => application.storage?.buckets ?? [])
const tenantOptions = computed(() => backendStorageTenantOptions(application))

watch(
  () => JSON.stringify(application.storage ?? null),
  () => {
    armedRemoval.value = ''
  }
)

function run(operation: () => void): void {
  operationError.value = ''
  armedRemoval.value = ''
  try {
    operation()
  } catch (cause) {
    operationError.value =
      cause instanceof BackendDraftOperationError
        ? cause.message
        : panels.value.lowcodeBackendOperationError
  }
}

function tenantLabel(tenantId: string): string {
  const tenant = application.auth.tenants.find((entry) => entry.id === tenantId)
  const entity = application.dataModel.entities.find((entry) => entry.id === tenant?.entityId)
  return entity ? `${entity.name} · ${tenantId}` : tenantId
}

function tenantId(rule: BackendStoragePathRuleIR): string {
  return rule.principal.kind === 'tenant-member' ? rule.principal.tenantId : ''
}

function mimeTypesText(bucket: BackendStorageBucketIR): string {
  return bucket.allowedMimeTypes.join(', ')
}

function updateMimeTypes(bucket: BackendStorageBucketIR, value: string): void {
  run(() => {
    const mimeTypes = [
      ...new Set(
        value
          .split(/[\n,]/u)
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      )
    ]
    if (mimeTypes.length === 0 || mimeTypes.length > BACKEND_LIMITS.maxStorageMimeTypes) {
      throw new BackendDraftOperationError(
        `Storage MIME types require 1-${BACKEND_LIMITS.maxStorageMimeTypes} unique items.`
      )
    }
    bucket.allowedMimeTypes = mimeTypes
  })
}

function prefixText(rule: BackendStoragePathRuleIR): string {
  return rule.prefix.join('/')
}

function updatePrefix(
  bucket: BackendStorageBucketIR,
  rule: BackendStoragePathRuleIR,
  value: string
): void {
  run(() => {
    const prefix = value
      .split('/')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (prefix.length > BACKEND_LIMITS.maxStoragePrefixSegments) {
      throw new BackendDraftOperationError(
        `Storage prefixes are limited to ${BACKEND_LIMITS.maxStoragePrefixSegments} segments.`
      )
    }
    if (
      bucket.pathRules.some(
        (candidate) =>
          candidate.id !== rule.id &&
          candidate.prefix.join('/') === prefix.join('/') &&
          candidate.principal.kind === rule.principal.kind &&
          (candidate.principal.kind !== 'tenant-member' ||
            (rule.principal.kind === 'tenant-member' &&
              candidate.principal.tenantId === rule.principal.tenantId)) &&
          candidate.operations.length === rule.operations.length &&
          candidate.operations.every((operation) => rule.operations.includes(operation))
      )
    ) {
      throw new BackendDraftOperationError('This Storage path prefix already exists.')
    }
    rule.prefix = prefix
  })
}

function updateMaxObjectBytes(bucket: BackendStorageBucketIR, value: string): void {
  run(() => {
    const bytes = Number(value)
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > BACKEND_LIMITS.maxStorageObjectBytes) {
      throw new BackendDraftOperationError(
        `Storage object size must be an integer between 1 and ${BACKEND_LIMITS.maxStorageObjectBytes}.`
      )
    }
    bucket.maxObjectBytes = bytes
  })
}

function changePrincipalKind(
  rule: BackendStoragePathRuleIR,
  kind: BackendStoragePrincipalIntent['kind']
): void {
  run(() =>
    setBackendStoragePathRulePrincipal(
      application,
      rule,
      kind,
      kind === 'tenant-member' ? tenantOptions.value[0]?.id : undefined
    )
  )
}

function changeTenant(rule: BackendStoragePathRuleIR, tenantId: string): void {
  run(() => setBackendStoragePathRulePrincipal(application, rule, 'tenant-member', tenantId))
}

function setOperation(
  rule: BackendStoragePathRuleIR,
  operation: BackendStorageOperation,
  enabled: boolean
): void {
  const selected = new Set(rule.operations)
  if (enabled) {
    selected.add(operation)
    if (operation === 'update' || operation === 'delete') selected.add('read')
    if (operation === 'upsert') {
      selected.add('read')
      selected.add('create')
      selected.add('update')
    }
  } else {
    selected.delete(operation)
  }
  rule.operations = operations.filter((candidate) => selected.has(candidate))
}

function operationLocked(
  rule: BackendStoragePathRuleIR,
  operation: BackendStorageOperation
): boolean {
  if (!rule.operations.includes(operation)) return false
  if (rule.operations.length === 1) return true
  if (
    operation === 'read' &&
    (rule.operations.includes('update') ||
      rule.operations.includes('delete') ||
      rule.operations.includes('upsert'))
  ) {
    return true
  }
  return (operation === 'create' || operation === 'update') && rule.operations.includes('upsert')
}

function removeBucket(bucketId: string): void {
  const armKey = `bucket:${bucketId}`
  if (armedRemoval.value !== armKey) {
    armedRemoval.value = armKey
    return
  }
  const index = application.storage?.buckets.findIndex((bucket) => bucket.id === bucketId) ?? -1
  if (index !== -1) application.storage?.buckets.splice(index, 1)
  if (application.storage?.buckets.length === 0) delete application.storage
  armedRemoval.value = ''
}

function removePathRule(bucket: BackendStorageBucketIR, ruleId: string): void {
  const armKey = `rule:${bucket.id}:${ruleId}`
  if (armedRemoval.value !== armKey) {
    armedRemoval.value = armKey
    return
  }
  const index = bucket.pathRules.findIndex((rule) => rule.id === ruleId)
  if (index !== -1) bucket.pathRules.splice(index, 1)
  armedRemoval.value = ''
}
</script>

<template>
  <div class="mt-2 flex flex-col gap-2" data-test-id="lowcode-backend-storage">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] text-muted">{{ panels.lowcodeBackendTabStorage }}</span>
      <button
        type="button"
        data-test-id="lowcode-backend-storage-add-bucket"
        :disabled="buckets.length >= BACKEND_LIMITS.maxStorageBuckets"
        class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
        @click="run(() => addBackendStorageBucket(application))"
      >
        {{ panels.lowcodeBackendStorageAddBucket }}
      </button>
    </div>
    <p class="text-[9px] leading-relaxed text-muted">
      {{ panels.lowcodeBackendStorageExtension }}
    </p>
    <p v-if="buckets.length === 0" class="text-[10px] text-muted">
      {{ panels.lowcodeBackendStorageNoBuckets }}
    </p>

    <section
      v-for="bucket in buckets"
      :key="bucket.id"
      data-test-id="lowcode-backend-storage-bucket"
      class="rounded border border-border bg-input/40 p-2"
    >
      <div class="grid grid-cols-2 gap-1.5">
        <label class="min-w-0 text-[9px] text-muted">
          <span class="mb-0.5 block">{{ panels.lowcodeBackendStorageBucketName }}</span>
          <input
            v-model="bucket.name"
            maxlength="63"
            data-test-id="lowcode-backend-storage-bucket-name"
            spellcheck="false"
            class="w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface outline-none focus:border-accent"
          />
        </label>
        <label class="min-w-0 text-[9px] text-muted">
          <span class="mb-0.5 block">{{ panels.lowcodeBackendStorageAccess }}</span>
          <select
            v-model="bucket.access"
            data-test-id="lowcode-backend-storage-access"
            class="w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface outline-none focus:border-accent"
          >
            <option value="private">{{ panels.lowcodeBackendStoragePrivate }}</option>
            <option value="public-read">{{ panels.lowcodeBackendStoragePublicRead }}</option>
          </select>
        </label>
      </div>
      <label class="mt-1.5 block min-w-0 text-[9px] text-muted">
        <span class="mb-0.5 block">{{ panels.lowcodeBackendStorageBucketId }}</span>
        <input
          :value="bucket.id"
          data-test-id="lowcode-backend-storage-bucket-id"
          readonly
          class="w-full rounded border border-border/60 bg-hover/40 px-1.5 py-1 font-mono text-[9px] text-muted outline-none"
        />
      </label>
      <p
        v-if="bucket.access === 'public-read'"
        role="alert"
        class="mt-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[9px] leading-relaxed text-amber-500"
      >
        {{ panels.lowcodeBackendStoragePublicReadWarning }}
      </p>
      <label class="mt-1.5 block text-[9px] text-muted">
        <span class="mb-0.5 block">{{ panels.lowcodeBackendStorageMaxObjectBytes }}</span>
        <input
          :value="bucket.maxObjectBytes"
          data-test-id="lowcode-backend-storage-max-bytes"
          type="number"
          min="1"
          max="5368709120"
          step="1"
          class="w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface outline-none focus:border-accent"
          @change="updateMaxObjectBytes(bucket, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="mt-1.5 block text-[9px] text-muted">
        <span class="mb-0.5 block">{{ panels.lowcodeBackendStorageAllowedMimeTypes }}</span>
        <textarea
          :value="mimeTypesText(bucket)"
          maxlength="12351"
          data-test-id="lowcode-backend-storage-mime-types"
          rows="2"
          spellcheck="false"
          class="w-full resize-y rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface outline-none focus:border-accent"
          @change="updateMimeTypes(bucket, ($event.target as HTMLTextAreaElement).value)"
        />
      </label>
      <p class="mt-0.5 text-[9px] leading-relaxed text-muted">
        {{ panels.lowcodeBackendStorageMimeTypesHint }}
      </p>

      <div class="mt-2 border-t border-border pt-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted">{{ panels.lowcodeBackendOperations }}</span>
          <button
            type="button"
            data-test-id="lowcode-backend-storage-add-rule"
            :disabled="bucket.pathRules.length >= BACKEND_LIMITS.maxStoragePathRules"
            class="rounded px-1 text-[10px] text-muted hover:bg-hover hover:text-surface"
            @click="run(() => addBackendStoragePathRule(application, { bucketId: bucket.id }))"
          >
            {{ panels.lowcodeBackendStorageAddPathRule }}
          </button>
        </div>
        <p v-if="bucket.pathRules.length === 0" class="mt-1 text-[9px] text-red-500">
          {{ panels.lowcodeBackendStorageNoPathRules }}
        </p>
        <div
          v-for="rule in bucket.pathRules"
          :key="rule.id"
          data-test-id="lowcode-backend-storage-path-rule"
          class="mt-1.5 rounded border border-border/70 p-1.5"
        >
          <label class="block text-[9px] text-muted">
            <span class="mb-0.5 block">{{ panels.lowcodeBackendStoragePathPrefix }}</span>
            <input
              :value="prefixText(rule)"
              maxlength="1039"
              data-test-id="lowcode-backend-storage-prefix"
              spellcheck="false"
              class="w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface outline-none focus:border-accent"
              @change="updatePrefix(bucket, rule, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <p class="mt-0.5 text-[9px] leading-relaxed text-muted">
            {{ panels.lowcodeBackendStoragePathPrefixHint }}
          </p>
          <div class="mt-1 grid grid-cols-2 gap-1">
            <label class="min-w-0 text-[9px] text-muted">
              <span class="mb-0.5 block">{{ panels.lowcodeBackendPrincipal }}</span>
              <select
                :value="rule.principal.kind"
                data-test-id="lowcode-backend-storage-principal"
                class="w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface outline-none focus:border-accent"
                @change="
                  changePrincipalKind(
                    rule,
                    ($event.target as HTMLSelectElement)
                      .value as BackendStoragePrincipalIntent['kind']
                  )
                "
              >
                <option value="owner">{{ panels.lowcodeBackendPrincipalOwner }}</option>
                <option value="tenant-member" :disabled="tenantOptions.length === 0">
                  {{ panels.lowcodeBackendPrincipalTenant }}
                </option>
              </select>
            </label>
            <label
              v-if="rule.principal.kind === 'tenant-member'"
              class="min-w-0 text-[9px] text-muted"
            >
              <span class="mb-0.5 block">{{ panels.lowcodeBackendStorageTenantRule }}</span>
              <select
                :value="tenantId(rule)"
                data-test-id="lowcode-backend-storage-tenant"
                class="w-full rounded border border-border bg-input px-1 py-1 text-[10px] text-surface outline-none focus:border-accent"
                @change="changeTenant(rule, ($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-if="!tenantOptions.some((tenant) => tenant.id === tenantId(rule))"
                  :value="tenantId(rule)"
                  disabled
                >
                  {{ tenantId(rule) }} · unavailable
                </option>
                <option v-for="tenant in tenantOptions" :key="tenant.id" :value="tenant.id">
                  {{ tenantLabel(tenant.id) }}
                </option>
              </select>
            </label>
          </div>
          <p v-if="tenantOptions.length === 0" class="mt-1 text-[9px] leading-relaxed text-muted">
            {{ panels.lowcodeBackendStorageNoTenantMembership }}
          </p>
          <div class="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-muted">
            <label v-for="operation in operations" :key="operation" class="flex items-center gap-1">
              <input
                type="checkbox"
                :checked="rule.operations.includes(operation)"
                :disabled="operationLocked(rule, operation)"
                @change="setOperation(rule, operation, ($event.target as HTMLInputElement).checked)"
              />{{ operation }}</label
            >
          </div>
          <p class="mt-1 text-[9px] leading-relaxed text-muted">
            {{ panels.lowcodeBackendStorageUpsertHint }}
          </p>
          <div class="mt-1 flex items-center justify-between gap-2">
            <code class="min-w-0 truncate text-[9px] text-muted">{{ rule.id }}</code>
            <button
              type="button"
              :aria-label="
                armedRemoval === `rule:${bucket.id}:${rule.id}`
                  ? panels.lowcodeBackendStorageConfirmRemove
                  : panels.lowcodeBackendStorageRemovePathRule
              "
              :aria-pressed="armedRemoval === `rule:${bucket.id}:${rule.id}`"
              :class="[
                'rounded border px-1.5 py-0.5 text-[9px]',
                armedRemoval === `rule:${bucket.id}:${rule.id}`
                  ? 'border-red-500 text-red-500'
                  : 'border-border text-muted hover:bg-hover hover:text-red-500'
              ]"
              @click="removePathRule(bucket, rule.id)"
            >
              {{
                armedRemoval === `rule:${bucket.id}:${rule.id}`
                  ? panels.lowcodeBackendStorageConfirmRemove
                  : panels.lowcodeBackendStorageRemovePathRule
              }}
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        data-test-id="lowcode-backend-storage-remove-bucket"
        :aria-pressed="armedRemoval === `bucket:${bucket.id}`"
        :class="[
          'mt-2 w-full rounded border px-2 py-1 text-[10px]',
          armedRemoval === `bucket:${bucket.id}`
            ? 'border-red-500 text-red-500'
            : 'border-border text-muted hover:bg-hover hover:text-red-500'
        ]"
        @click="removeBucket(bucket.id)"
      >
        {{
          armedRemoval === `bucket:${bucket.id}`
            ? panels.lowcodeBackendStorageConfirmRemove
            : panels.lowcodeBackendStorageRemoveBucket
        }}
      </button>
    </section>

    <p
      v-if="operationError"
      role="alert"
      data-test-id="lowcode-backend-storage-operation-error"
      class="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9px] text-red-500"
    >
      {{ operationError }}
    </p>
  </div>
</template>
