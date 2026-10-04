<script setup lang="ts">
import { computed, useId } from 'vue'

import { useCommonMessages, usePageMessages } from '@open-pencil/vue'

import type { ApplicationShellPanelModel } from '@/app/lowcode/application-mode/shell/types'
import type { ApplicationModeOption } from '@/app/lowcode/application-mode/types'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { model } = defineProps<{ model: ApplicationShellPanelModel }>()
const messages = usePageMessages()
const common = useCommonMessages()
const id = useId()
function withUnavailable(value: string, options: ApplicationModeOption[]) {
  if (!value || options.some((option) => option.value === value)) return options
  return [{ value, label: messages.value.applicationModeUnavailable, disabled: true }, ...options]
}
const frames = computed(() => withUnavailable(model.frameNodeId, model.frames))
const slots = computed(() => withUnavailable(model.slotNodeId, model.slots))
</script>

<template>
  <section
    class="space-y-2 border-t border-border pt-2"
    :aria-labelledby="`${id}-title`"
    data-test-id="application-shell-settings"
  >
    <h3 :id="`${id}-title`" class="text-xs font-medium">{{ messages.applicationShellTitle }}</h3>
    <p class="text-[10px] leading-relaxed text-muted">{{ messages.applicationShellHint }}</p>
    <p class="text-[10px] leading-relaxed text-muted">{{ messages.applicationShellStateHint }}</p>
    <AppAlert
      v-if="model.invalid"
      tone="warning"
      :heading="messages.applicationShellTitle"
      :description="messages.applicationShellInvalid"
      data-test-id="application-shell-invalid"
    />
    <div class="space-y-1">
      <label :for="`${id}-frame`" class="text-[11px] text-muted">{{
        messages.applicationShellFrame
      }}</label>
      <AppSelect
        :key="`frame-${model.version}`"
        :id="`${id}-frame`"
        :model-value="model.frameNodeId"
        :options="frames"
        :label="messages.applicationShellFrame"
        :placeholder="messages.applicationShellChooseFrame"
        :disabled="model.disabled"
        data-property="application-shell-frame"
        @update:model-value="model.selectFrame"
      />
    </div>
    <div class="space-y-1">
      <label :for="`${id}-slot`" class="text-[11px] text-muted">{{
        messages.applicationShellSlot
      }}</label>
      <AppSelect
        :key="`slot-${model.version}`"
        :id="`${id}-slot`"
        :model-value="model.slotNodeId"
        :options="slots"
        :label="messages.applicationShellSlot"
        :placeholder="messages.applicationShellChooseSlot"
        :disabled="model.disabled || !model.frameNodeId"
        data-property="application-shell-slot"
        @update:model-value="model.selectSlot"
      />
    </div>
    <p v-if="model.dirty" class="text-[10px] leading-relaxed text-muted" role="status">
      {{ messages.applicationShellDraftHint }}
    </p>
    <div class="flex flex-wrap gap-1">
      <AppButton
        color="primary"
        variant="solid"
        :disabled="!model.canApply"
        data-command="application-shell-apply"
        @click="model.apply"
        >{{ messages.applicationShellApply }}</AppButton
      >
      <AppButton
        :disabled="model.disabled || !model.dirty"
        data-command="application-shell-cancel"
        @click="model.cancel"
        >{{ common.cancel }}</AppButton
      >
      <AppButton
        v-if="model.configured"
        :disabled="model.disabled"
        data-command="application-shell-remove"
        @click="model.remove"
        >{{ messages.applicationShellRemove }}</AppButton
      >
    </div>
  </section>
</template>
