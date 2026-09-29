<script setup lang="ts">
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import { orgChartParentChoices, orgChartParentValue } from '@/app/lowcode/org-chart-editor'
import { useOrgChartDraft } from '@/app/lowcode/org-chart-editor/use'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

const { owner, config } = defineProps<{ owner?: SceneNode; config: JSONObject }>()
const emit = defineEmits<{ commit: [request: ModuleScalarCommit] }>()
const p = usePanelMessages()
const chart = useOrgChartDraft(
  () => owner,
  () => config,
  (request) => emit('commit', request),
  useRetainedActivity()
)
const { draft, rows, generation, invalid, dirty, begin, input, edit, apply, cancel } = chart
function version(event: Event) {
  const target = event.currentTarget
  return target instanceof Element && target.isConnected
    ? Number(
        target.closest('[data-org-chart-generation]')?.getAttribute('data-org-chart-generation') ??
          -1
      )
    : -1
}
function parent(id: string, value: string, rendered: number) {
  if (value === 'root' || value.startsWith('node:'))
    edit({ kind: 'parent', id, parentId: value === 'root' ? '' : value.slice(5) }, rendered)
}
function canMove(id: string, offset: -1 | 1) {
  const item = draft.value.items.find((entry) => entry.id === id)
  const siblings = draft.value.items.filter((entry) => entry.parentId === item?.parentId)
  const target = siblings.findIndex((entry) => entry.id === id) + offset
  return target >= 0 && target < siblings.length
}
</script>

<template>
  <div
    :key="generation"
    :data-org-chart-generation="generation"
    data-test-id="org-chart-items-editor"
    class="flex min-w-0 flex-col gap-2"
    role="group"
    :aria-label="p.lowcodeModuleOrgChartItems"
  >
    <p class="text-[10px] leading-relaxed text-muted">{{ p.lowcodeOrgChartEditorHint }}</p>
    <span class="text-right text-[10px] text-muted">{{ rows.length }} / 64</span>
    <div class="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
      <fieldset
        v-for="(row, index) in rows"
        :key="row.id"
        data-test-id="org-chart-item-row"
        class="min-w-0 rounded border border-border bg-input p-2"
      >
        <legend class="px-1 text-[10px] text-surface">{{ index + 1 }} · {{ row.label }}</legend>
        <label class="mb-2 block text-[10px] text-muted"
          >{{ p.lowcodeOrgChartItemLabel }}
          <AppInput
            :model-value="row.label"
            :ariaLabel="p.lowcodeOrgChartItemLabel"
            :maxlength="120"
            data-test-id="org-chart-item-label"
            @focus="begin(row.id, 'label', row.generation)"
            @update:model-value="input(row.id, 'label', $event, row.generation)"
          />
        </label>
        <label class="mb-2 block text-[10px] text-muted"
          >{{ p.lowcodeOrgChartItemDescription }}
          <AppInput
            :model-value="row.description"
            :ariaLabel="p.lowcodeOrgChartItemDescription"
            :maxlength="240"
            data-test-id="org-chart-item-description"
            @focus="begin(row.id, 'description', row.generation)"
            @update:model-value="input(row.id, 'description', $event, row.generation)"
          />
        </label>
        <AppSelect
          :model-value="orgChartParentValue(row.parentId)"
          :options="orgChartParentChoices(draft, row.id, p.lowcodeOrgChartRoot)"
          :label="p.lowcodeOrgChartParent"
          data-test-id="org-chart-item-parent"
          @update:model-value="parent(row.id, $event, row.generation)"
        />
        <label
          v-if="draft.items.some((entry) => entry.parentId === row.id)"
          class="my-2 flex items-center gap-1 text-[10px] text-surface"
        >
          <AppCheckbox
            :model-value="draft.initialCollapsedIds.includes(row.id)"
            :disabled="config.collapsible !== true"
            :ariaLabel="p.lowcodeOrgChartCollapsed"
            data-test-id="org-chart-item-collapsed"
            @update:model-value="
              edit({ kind: 'collapsed', id: row.id, value: $event }, row.generation)
            "
          />{{ p.lowcodeOrgChartCollapsed }}
        </label>
        <div class="mt-2 flex flex-wrap gap-1">
          <AppButton
            variant="outline"
            size="xs"
            :disabled="rows.length >= 64"
            data-test-id="org-chart-item-child"
            @click="
              edit(
                { kind: 'add', parentId: row.id, label: p.lowcodeOrgChartNewItem },
                row.generation
              )
            "
            >{{ p.lowcodeOrgChartAddChild }}</AppButton
          >
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="!canMove(row.id, -1)"
            data-test-id="org-chart-item-up"
            @click="edit({ kind: 'move', id: row.id, offset: -1 }, row.generation)"
            >{{ p.lowcodeOrgChartMoveUp }}</AppButton
          >
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="!canMove(row.id, 1)"
            data-test-id="org-chart-item-down"
            @click="edit({ kind: 'move', id: row.id, offset: 1 }, row.generation)"
            >{{ p.lowcodeOrgChartMoveDown }}</AppButton
          >
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="rows.length <= 1"
            data-test-id="org-chart-item-remove"
            @click="edit({ kind: 'remove', id: row.id }, row.generation)"
            >{{ p.lowcodeOrgChartRemove }}</AppButton
          >
        </div>
      </fieldset>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      :disabled="rows.length >= 64"
      data-test-id="org-chart-item-add"
      @click="edit({ kind: 'add', label: p.lowcodeOrgChartNewItem }, version($event))"
      >{{ p.lowcodeOrgChartAdd }}</AppButton
    >
    <AppAlert
      v-if="invalid"
      tone="warning"
      :heading="p.lowcodeOrgChartInvalid"
      data-test-id="org-chart-draft-error"
    />
    <p v-if="dirty" role="status" class="text-[10px] text-muted">{{ p.lowcodeOrgChartPending }}</p>
    <div class="flex gap-2">
      <AppButton
        size="xs"
        :disabled="!dirty"
        data-test-id="org-chart-apply"
        @click="apply(version($event))"
        >{{ p.lowcodeOrgChartApply }}</AppButton
      >
      <AppButton
        variant="ghost"
        size="xs"
        :disabled="!dirty"
        data-test-id="org-chart-cancel"
        @click="cancel(version($event))"
        >{{ p.lowcodeOrgChartCancel }}</AppButton
      >
    </div>
  </div>
</template>
