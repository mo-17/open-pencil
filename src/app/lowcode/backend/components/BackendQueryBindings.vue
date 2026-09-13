<script setup lang="ts">
import { computed } from 'vue'
import type { BackendHttpAPIResourceIRV1 } from '@open-pencil/lowcode/backend'
import type { BackendListQueryBinding } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { nestJSUICopy } from './nestjs-ui-copy'

const { query, resource } = defineProps<{
  query: BackendListQueryBinding
  resource: BackendHttpAPIResourceIRV1 | undefined
}>()
const emit = defineEmits<{ 'update:query': [Partial<BackendListQueryBinding>] }>()
const { locale } = useI18n()
const text = computed(() => nestJSUICopy(locale.value))
const hasBindings = computed(() =>
  Boolean(query.filterEntries?.length || query.searchExpr || query.sortField || query.sortDirection)
)

function filterValue(key: string): string {
  return query.filterEntries?.find((entry) => entry.key === key)?.valueExpr ?? ''
}

function setFilter(key: string, valueExpr: string): void {
  if (!resource?.query?.filterFields.includes(key)) return
  const entries = (query.filterEntries ?? []).filter((entry) => entry.key !== key)
  if (valueExpr.trim()) entries.push({ key, valueExpr })
  emit('update:query', { filterEntries: entries.length ? entries : undefined })
}

function setSort(sortField: string): void {
  if (sortField && !resource?.query?.sortFields.includes(sortField)) return
  emit('update:query', {
    sortField: sortField || undefined,
    sortDirection: sortField ? (query.sortDirection ?? 'asc') : undefined
  })
}
</script>

<template>
  <fieldset
    v-if="resource?.query || hasBindings"
    class="min-w-0 space-y-2 rounded border border-border p-2"
  >
    <legend class="text-[10px] text-surface">{{ text.bindings }}</legend>
    <label
      v-for="key in resource?.query?.filterFields ?? []"
      :key="key"
      class="flex flex-col gap-1 text-[10px] text-muted"
    >
      {{ key }} · {{ text.filterExpression }}
      <input
        :value="filterValue(key)"
        maxlength="2048"
        class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        @change="setFilter(key, ($event.target as HTMLInputElement).value)"
      />
    </label>
    <label
      v-if="resource?.query?.searchFields.length"
      class="flex flex-col gap-1 text-[10px] text-muted"
    >
      {{ text.searchExpression }}
      <input
        :value="query.searchExpr ?? ''"
        maxlength="2048"
        class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        @change="
          emit('update:query', {
            searchExpr: ($event.target as HTMLInputElement).value || undefined
          })
        "
      />
    </label>
    <template v-if="resource?.query?.sortFields.length">
      <label class="flex flex-col gap-1 text-[10px] text-muted">
        {{ text.sortField }}
        <select
          :value="query.sortField ?? ''"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
          @change="setSort(($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ text.noSort }}</option>
          <option v-for="key in resource.query.sortFields" :key="key" :value="key">
            {{ key }}
          </option>
        </select>
      </label>
      <label v-if="query.sortField" class="flex flex-col gap-1 text-[10px] text-muted">
        {{ text.sortDirection }}
        <select
          :value="query.sortDirection ?? 'asc'"
          class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
          @change="
            emit('update:query', {
              sortDirection: ($event.target as HTMLSelectElement).value as 'asc' | 'desc'
            })
          "
        >
          <option value="asc">{{ text.ascending }}</option>
          <option value="desc">{{ text.descending }}</option>
        </select>
      </label>
    </template>
    <button
      v-if="hasBindings"
      type="button"
      class="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover"
      @click="
        emit('update:query', {
          filterEntries: undefined,
          searchExpr: undefined,
          sortField: undefined,
          sortDirection: undefined
        })
      "
    >
      {{ text.clearQuery }}
    </button>
  </fieldset>
</template>
