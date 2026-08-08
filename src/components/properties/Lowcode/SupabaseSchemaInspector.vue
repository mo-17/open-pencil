<script setup lang="ts">
import { computed, onScopeDispose, ref, toRef } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useSupabaseSchemaInspector } from '@/app/lowcode/supabase/schema-inspector'
import type {
  SupabaseSchemaRelation,
  SupabaseSchemaTable
} from '@/app/lowcode/supabase/schema-catalog'

const { config } = defineProps<{ config?: SupabaseConfig }>()
const { panels } = useI18n()
const inspector = useSupabaseSchemaInspector(toRef(() => config))
const patInput = ref<HTMLInputElement>()
const expandedTables = ref<ReadonlySet<string>>(new Set())
const copiedIdentifier = ref('')
const copyFailed = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

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
  if (!input) return
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
  if (patInput.value) patInput.value.value = ''
  await inspector.clearCredential()
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

onScopeDispose(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
  if (patInput.value) patInput.value.value = ''
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
        :disabled="inspector.credentialBusy.value"
        class="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
        @click="savePat"
      >
        {{ panels.lowcodeSupabaseSchemaSavePat }}
      </button>
      <button
        v-if="inspector.credentialStatus.value === 'configured'"
        type="button"
        data-test-id="lowcode-supabase-schema-pat-clear"
        :disabled="inspector.credentialBusy.value"
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
      :disabled="inspector.requestState.value === 'loading'"
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
  </section>
</template>
