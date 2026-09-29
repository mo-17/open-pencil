<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import {
  walktourTargetOptions,
  walktourTargetValue,
  type WalktourTargetOption
} from '@/app/lowcode/walktour-editor'
import { useWalktourDraft } from '@/app/lowcode/walktour-editor/use'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { owner, config, targets } = defineProps<{
  owner?: SceneNode
  config: JSONObject
  targets: WalktourTargetOption[]
}>()
const emit = defineEmits<{ commit: [request: ModuleScalarCommit] }>()
const p = usePanelMessages()
const { steps, version, rows, invalid, dirty, begin, input, edit, apply, cancel } =
  useWalktourDraft(
    () => owner,
    () => config,
    (request) => emit('commit', request),
    useRetainedActivity()
  )
const placements = computed(() => [
  { value: 'top', label: p.value.lowcodeCarouselTop },
  { value: 'right', label: p.value.lowcodeCarouselRight },
  { value: 'bottom', label: p.value.lowcodeCarouselBottom },
  { value: 'left', label: p.value.lowcodeCarouselLeft }
])
const choices = (id: string) =>
  walktourTargetOptions(
    steps.value,
    id,
    targets,
    p.value.lowcodeWalktourOverview,
    p.value.lowcodeWalktourUnavailable
  )
function choose(id: string, value: string, rendered: number) {
  if (choices(id).some((option) => option.value === value && !option.disabled))
    edit(
      {
        kind: 'field',
        id,
        field: 'targetChildName',
        value: value === 'overview' ? '' : value.slice(6)
      },
      rendered
    )
}
function eventVersion(event: Event) {
  const node = event.currentTarget
  return node instanceof Element && node.isConnected
    ? Number(node.closest('[data-walktour-version]')?.getAttribute('data-walktour-version') ?? -1)
    : -1
}
</script>

<template>
  <div
    :key="version"
    :data-walktour-version="version"
    data-test-id="walktour-steps-editor"
    class="flex min-w-0 flex-col gap-2"
    role="group"
    :aria-label="p.lowcodeModuleWalktourSteps"
  >
    <p class="text-[10px] leading-relaxed text-muted">{{ p.lowcodeWalktourEditorHint }}</p>
    <span class="text-right text-[10px] text-muted">{{ rows.length }} / 12</span>
    <div class="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
      <fieldset
        v-for="(row, index) in rows"
        :key="row.id"
        data-test-id="walktour-step-row"
        class="min-w-0 rounded border border-border bg-input p-2"
      >
        <legend class="px-1 text-[10px] text-surface">{{ index + 1 }} · {{ row.title }}</legend>
        <label class="mb-2 block text-[10px] text-muted"
          >{{ p.lowcodeModuleFieldModalTitle }}
          <AppInput
            :model-value="row.title"
            :ariaLabel="p.lowcodeModuleFieldModalTitle"
            maxlength="120"
            data-test-id="walktour-step-title"
            @focus="begin(row.id, 'title', row.version)"
            @update:model-value="input(row.id, 'title', $event, row.version)"
          />
        </label>
        <label class="mb-2 block text-[10px] text-muted"
          >{{ p.lowcodeModuleFieldModalContent }}
          <AppTextarea
            :model-value="row.content"
            :aria-label="p.lowcodeModuleFieldModalContent"
            maxlength="2000"
            :rows="3"
            data-test-id="walktour-step-content"
            @focus="begin(row.id, 'content', row.version)"
            @update:model-value="input(row.id, 'content', $event, row.version)"
          />
        </label>
        <AppSelect
          :model-value="walktourTargetValue(row.targetChildName)"
          :options="choices(row.id)"
          :label="p.lowcodeWalktourTarget"
          data-test-id="walktour-step-target"
          @update:model-value="choose(row.id, $event, row.version)"
        />
        <AppSelect
          class="mt-2"
          :model-value="row.placement"
          :options="placements"
          :label="p.lowcodeWalktourPlacement"
          data-test-id="walktour-step-placement"
          @update:model-value="
            edit({ kind: 'field', id: row.id, field: 'placement', value: $event }, row.version)
          "
        />
        <div class="mt-2 flex gap-1">
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="index === 0"
            data-test-id="walktour-step-up"
            @click="edit({ kind: 'move', id: row.id, offset: -1 }, row.version)"
            >{{ p.lowcodeOrgChartMoveUp }}</AppButton
          >
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="index === rows.length - 1"
            data-test-id="walktour-step-down"
            @click="edit({ kind: 'move', id: row.id, offset: 1 }, row.version)"
            >{{ p.lowcodeOrgChartMoveDown }}</AppButton
          >
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="rows.length <= 1"
            data-test-id="walktour-step-remove"
            @click="edit({ kind: 'remove', id: row.id }, row.version)"
            >{{ p.lowcodeWalktourRemove }}</AppButton
          >
        </div>
      </fieldset>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      :disabled="rows.length >= 12"
      data-test-id="walktour-step-add"
      @click="edit({ kind: 'add', title: p.lowcodeWalktourNewStep }, eventVersion($event))"
      >{{ p.lowcodeWalktourAdd }}</AppButton
    >
    <AppAlert
      v-if="invalid"
      tone="warning"
      :heading="p.lowcodeWalktourInvalid"
      data-test-id="walktour-draft-error"
    />
    <p v-if="dirty" role="status" class="text-[10px] text-muted">
      {{ p.lowcodeDescriptionsPending }}
    </p>
    <div class="flex gap-2">
      <AppButton
        size="xs"
        :disabled="!dirty"
        data-test-id="walktour-apply"
        @click="apply(eventVersion($event))"
        >{{ p.lowcodeWalktourApply }}</AppButton
      >
      <AppButton
        variant="ghost"
        size="xs"
        :disabled="!dirty"
        data-test-id="walktour-cancel"
        @click="cancel(eventVersion($event))"
        >{{ p.lowcodeDescriptionsCancel }}</AppButton
      >
    </div>
  </div>
</template>
