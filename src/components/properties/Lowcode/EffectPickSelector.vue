<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { EFFECT_PICK_CATALOG, type EffectPickConfigV1 } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import { getActiveEditorStore } from '@/app/editor/active-store'
import { effectPickInactiveEvents, switchEffectPick } from '@/app/effect-pick/switch'
import { useModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { node, config } = defineProps<{ node: SceneNode; config: EffectPickConfigV1 }>()
const panels = usePanelMessages()
const editor = getActiveEditorStore()
const active = useRetainedActivity()
const failed = ref(false)
watch(
  () => [node, config],
  () => {
    failed.value = false
  },
  { flush: 'sync' }
)
const { ownerGeneration, beginInput, submit } = useModuleScalarCommit(
  () => node,
  () => config,
  (request) => {
    if (
      getActiveEditorStore() !== editor ||
      request.value.kind !== 'value' ||
      typeof request.value.value !== 'string'
    )
      return
    try {
      switchEffectPick(
        editor,
        { ...request, value: request.value.value },
        panels.value.effectPickSwitchEffect
      )
    } catch {
      failed.value = true
    }
  },
  active
)
const model = computed({
  get: () => config.effectId,
  set: (value: string) => submit({ kind: 'value', value })
})
const options = EFFECT_PICK_CATALOG.map((entry) => ({ value: entry.id, label: entry.title }))
const clickInactive = computed(() => {
  void editor.state.sceneVersion
  return effectPickInactiveEvents(node).includes('onClick')
})
</script>

<template>
  <div
    data-test-id="effect-pick-selector"
    class="mb-3 flex flex-col gap-1.5"
    @focusin="beginInput(ownerGeneration)"
    @pointerdown.capture="beginInput(ownerGeneration)"
    @keydown.capture="beginInput(ownerGeneration)"
  >
    <label class="text-[10px] text-muted">{{ panels.effectPickSwitchEffect }}</label>
    <AppSelect
      :key="ownerGeneration"
      v-model="model"
      :options="options"
      :label="panels.effectPickSwitchEffect"
    />
    <p class="text-[10px] leading-relaxed text-muted">{{ panels.effectPickSwitchHint }}</p>
    <AppAlert v-if="clickInactive" tone="warning" :heading="panels.effectPickClickInactive" />
    <AppAlert v-if="failed" tone="error" :heading="panels.effectPickSwitchError" />
  </div>
</template>
