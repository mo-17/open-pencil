<script setup lang="ts">
import { computed } from 'vue'
import { validateBackendResourceDataSource } from '@open-pencil/lowcode/backend'
import type { BackendResourceDataSource } from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { useBackendBindingApplication } from '@/app/lowcode/backend/bindings/context'
import BackendQueryBindings from '@/app/lowcode/backend/components/BackendQueryBindings.vue'

const { source } = defineProps<{ source: BackendResourceDataSource }>()
const emit = defineEmits<{ 'update:source': [BackendResourceDataSource] }>()
const { panels } = useI18n()
const editor = useEditorStore()
const application = useBackendBindingApplication()
const states = useSceneComputed(
  () => editor.graph.getNode(editor.graph.rootId)?.lowcodeDocumentState ?? []
)
const stringStates = computed(() =>
  states.value.filter((state) => state.type === 'string' && !state.persist && !state.computedExpr)
)
const diagnostics = computed(() =>
  application.value
    ? validateBackendResourceDataSource(application.value, source, states.value)
    : []
)
const resource = computed(() =>
  application.value?.httpApi?.resources.find((entry) => entry.id === source.resourceId)
)
function patch(value: Partial<BackendResourceDataSource>): void {
  emit('update:source', { ...source, ...value })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-property="backend-list-source">
    <BackendQueryBindings :query="source" :resource="resource" @update:query="patch" />
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ panels.lowcodeBackendPageSize }}
      <input
        :value="source.limit ?? ''"
        type="number"
        min="1"
        :max="resource?.maxPageSize ?? 100"
        class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        @change="
          patch({
            limit: ($event.target as HTMLInputElement).value
              ? Number(($event.target as HTMLInputElement).value)
              : undefined
          })
        "
      />
    </label>
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ panels.lowcodeBackendAfterExpression }}
      <input
        :value="source.afterExpr ?? ''"
        maxlength="2048"
        class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        @change="patch({ afterExpr: ($event.target as HTMLInputElement).value || undefined })"
      />
    </label>
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ panels.lowcodeBackendCursorState }}
      <select
        :value="source.nextCursorTarget ?? ''"
        class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        @change="
          patch({ nextCursorTarget: ($event.target as HTMLSelectElement).value || undefined })
        "
      >
        <option value="">—</option>
        <option v-for="state in stringStates" :key="state.id" :value="state.name">
          {{ state.name }}
        </option>
      </select>
    </label>
    <label class="flex flex-col gap-1 text-[10px] text-muted"
      >{{ panels.lowcodeBackendErrorState }}
      <select
        :value="source.errorTarget ?? ''"
        class="rounded border border-border bg-input px-2 py-1 text-xs text-surface"
        @change="patch({ errorTarget: ($event.target as HTMLSelectElement).value || undefined })"
      >
        <option value="">—</option>
        <option v-for="state in stringStates" :key="state.id" :value="state.name">
          {{ state.name }}
        </option>
      </select>
    </label>
    <ul v-if="diagnostics.length" class="space-y-1 text-[10px] text-red-500">
      <li v-for="(entry, index) in diagnostics" :key="index">{{ entry.message }}</li>
    </ul>
  </div>
</template>
