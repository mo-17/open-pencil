<script setup lang="ts">
import { computed } from 'vue'

import { treeItemDisabled } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useRetainedActivity } from '@open-pencil/vue'

import type { TreeEditorCommit } from '@/app/lowcode/tree-editor'
import { treeEditorCopy } from '@/app/lowcode/tree-editor/copy'
import { treeParentChoices, treeParentId, treeParentValue } from '@/app/lowcode/tree-editor/parents'
import { useTreeEditorDraft } from '@/app/lowcode/tree-editor/use'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'
const { owner, config, label } = defineProps<{
  owner?: SceneNode
  config: JSONObject
  label: string
}>()
const emit = defineEmits<{ commit: [request: TreeEditorCommit] }>()
const { locale } = useI18n(),
  text = computed(() => treeEditorCopy(locale.value, Array.isArray(config.initialPath))),
  active = useRetainedActivity()
const { draft, rows, generation, invalid, dirty, begin, input, edit, apply, cancel } =
  useTreeEditorDraft(
    () => owner,
    () => config,
    (request) => emit('commit', request),
    active
  )
function parents(id: string) {
  return treeParentChoices(draft.value.items, id, text.value.root)
}
function setParent(index: number, value: string, generation: number) {
  const item = draft.value.items[index]
  if (!item || !parents(item.id).some((choice) => choice.value === value)) return
  const parentId = treeParentId(value)
  if (parentId !== undefined)
    edit({ kind: 'text', index, field: 'parentId', value: parentId }, generation)
}
function version(event: Event) {
  return event.currentTarget instanceof HTMLElement
    ? Number(event.currentTarget.dataset.treeGeneration)
    : -1
}
</script>
<template>
  <div
    :key="generation"
    data-test-id="tree-items-editor"
    role="group"
    :aria-label="label"
    class="flex min-w-0 flex-col gap-2"
  >
    <p class="text-[10px] leading-relaxed text-muted">{{ text.hint }}</p>
    <span class="text-right text-[10px] text-muted">{{ rows.length }} / 128</span>
    <div class="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
      <fieldset
        v-for="row in rows"
        :key="row.index"
        data-test-id="tree-item-row"
        class="min-w-0 rounded border border-border bg-input p-2"
      >
        <legend class="px-1 text-[10px] text-surface">
          {{ row.index + 1 }} · {{ row.item.label }}
        </legend>
        <label class="mb-2 block text-[10px] text-muted"
          >{{ text.id
          }}<AppInput
            :model-value="row.item.id"
            :ariaLabel="text.id"
            :maxlength="48"
            data-test-id="tree-item-id"
            @focus="begin(row.generation)"
            @update:model-value="input(row.index, 'id', $event, row.generation)"
        /></label>
        <label class="mb-2 block text-[10px] text-muted"
          >{{ text.label
          }}<AppInput
            :model-value="row.item.label"
            :ariaLabel="text.label"
            :maxlength="120"
            data-test-id="tree-item-label"
            @focus="begin(row.generation)"
            @update:model-value="input(row.index, 'label', $event, row.generation)"
        /></label>
        <AppSelect
          :model-value="treeParentValue(row.item.parentId)"
          :options="parents(row.item.id)"
          :label="text.parent"
          data-test-id="tree-item-parent"
          @update:model-value="setParent(row.index, $event, row.generation)"
        />
        <div class="my-2 flex flex-wrap gap-2 text-[10px] text-surface">
          <label class="flex items-center gap-1"
            ><AppCheckbox
              :model-value="row.item.disabled"
              :ariaLabel="text.disabled"
              data-test-id="tree-item-disabled"
              @update:model-value="
                edit(
                  {
                    kind: 'toggle',
                    index: row.index,
                    field: 'disabled',
                    value: $event,
                    multiple: config.selectionMode === 'multiple'
                  },
                  row.generation
                )
              "
            />{{ text.disabled }}</label
          >
          <label class="flex items-center gap-1"
            ><AppCheckbox
              :model-value="draft.initialSelectedIds.includes(row.item.id)"
              :disabled="
                treeItemDisabled(draft.items, row.item.id) ||
                (Array.isArray(config.initialPath) &&
                  draft.items.some((item) => item.parentId === row.item.id))
              "
              :ariaLabel="text.selected"
              data-test-id="tree-item-selected"
              @update:model-value="
                edit(
                  {
                    kind: 'toggle',
                    index: row.index,
                    field: 'selected',
                    value: $event,
                    multiple: config.selectionMode === 'multiple'
                  },
                  row.generation
                )
              "
            />{{ text.selected }}</label
          >
          <label
            v-if="
              !Array.isArray(config.initialPath) &&
              draft.items.some((item) => item.parentId === row.item.id)
            "
            class="flex items-center gap-1"
            ><AppCheckbox
              :model-value="draft.initialExpandedIds.includes(row.item.id)"
              :ariaLabel="text.expanded"
              data-test-id="tree-item-expanded"
              @update:model-value="
                edit(
                  {
                    kind: 'toggle',
                    index: row.index,
                    field: 'expanded',
                    value: $event,
                    multiple: config.selectionMode === 'multiple'
                  },
                  row.generation
                )
              "
            />{{ text.expanded }}</label
          >
        </div>
        <div class="flex gap-2">
          <AppButton
            variant="outline"
            size="xs"
            :disabled="rows.length >= 128"
            @click="
              edit({ kind: 'add', label: text.newItem, parentId: row.item.id }, row.generation)
            "
            >{{ text.child }}</AppButton
          ><AppButton
            variant="ghost"
            size="xs"
            :disabled="rows.length <= 1"
            :aria-label="text.remove"
            data-test-id="tree-item-remove"
            @click="edit({ kind: 'remove', index: row.index }, row.generation)"
            >{{ text.remove }}</AppButton
          >
        </div>
      </fieldset>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      :disabled="rows.length >= 128"
      :data-tree-generation="generation"
      data-test-id="tree-item-add"
      @click="edit({ kind: 'add', label: text.newItem }, version($event))"
      >{{ text.add }}</AppButton
    >
    <AppAlert
      v-if="invalid"
      tone="warning"
      :heading="text.invalid"
      data-test-id="tree-draft-error"
    />
    <div class="flex gap-2">
      <AppButton
        size="xs"
        :disabled="!dirty"
        :data-tree-generation="generation"
        data-test-id="tree-apply"
        @click="apply(version($event))"
        >{{ text.apply }}</AppButton
      ><AppButton
        variant="ghost"
        size="xs"
        :disabled="!dirty"
        :data-tree-generation="generation"
        data-test-id="tree-restore"
        @click="cancel(version($event))"
        >{{ text.restore }}</AppButton
      >
    </div>
  </div>
</template>
