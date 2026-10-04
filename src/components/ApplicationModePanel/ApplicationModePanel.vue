<script setup lang="ts">
import { computed, useId } from 'vue'

import { useCommonMessages, usePageMessages } from '@open-pencil/vue'

import type {
  ApplicationModeOption,
  ApplicationModePanelModel
} from '@/app/lowcode/application-mode/types'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

import GuardSettings from './GuardSettings.vue'
import RouteField from './RouteField.vue'
import ShellSettings from './ShellSettings.vue'

const { model } = defineProps<{ model: ApplicationModePanelModel }>()
const messages = usePageMessages()
const common = useCommonMessages()
const id = useId()
const roles = computed(() => [
  { value: 'application', label: messages.value.applicationModeApplication },
  { value: 'reference', label: messages.value.applicationModeReference },
  { value: 'components', label: messages.value.applicationModeComponents }
])
const stateRetentions = computed(() => [
  { value: 'reset', label: messages.value.applicationStateRetentionReset },
  { value: 'preserve', label: messages.value.applicationStateRetentionPreserve }
])
const entries = computed(() => unavailableOption(model.entryId, model.entries))
const starts = computed(() =>
  unavailableOption(
    model.startId,
    model.starts.map((option) =>
      option.disabled
        ? { ...option, label: `${option.label} · ${messages.value.applicationModeStartStaticOnly}` }
        : option
    )
  )
)
function unavailableOption(value: string, options: ApplicationModeOption[]) {
  if (!value || options.some((option) => option.value === value)) return options
  return [{ value, label: messages.value.applicationModeUnavailable, disabled: true }, ...options]
}
</script>

<template>
  <section
    class="space-y-2 border-t border-border bg-panel p-2 text-xs text-surface"
    data-test-id="application-mode-panel"
    :aria-label="messages.applicationModeTitle"
  >
    <label :for="`${id}-mode`" class="flex min-h-7 items-center gap-2">
      <AppCheckbox
        :id="`${id}-mode`"
        :model-value="model.enabled"
        :ariaLabel="messages.applicationModeTitle"
        :disabled="model.modeDisabled"
        data-property="application-mode"
        @update:model-value="model.setEnabled"
      />
      <span>{{ messages.applicationModeTitle }}</span>
    </label>
    <p class="text-[10px] leading-relaxed text-muted">{{ messages.applicationModeHint }}</p>
    <AppAlert
      v-if="model.invalid"
      tone="warning"
      :heading="messages.applicationModeInvalidTitle"
      :description="messages.applicationModeInvalid"
    />
    <div v-if="model.enabled" class="space-y-2">
      <div class="space-y-1">
        <div class="flex items-center justify-between gap-1">
          <label :for="`${id}-role`" class="text-[11px] text-muted">{{
            messages.applicationModeRole
          }}</label>
          <IconButton
            v-if="model.role"
            :disabled="model.pageDisabled"
            :label="`${common.clear}: ${messages.applicationModeRole}`"
            data-command="application-role-clear"
            @click="model.setRole('')"
            ><icon-lucide-rotate-ccw class="size-3"
          /></IconButton>
        </div>
        <AppSelect
          :key="`role-${model.version}`"
          :id="`${id}-role`"
          :model-value="model.role"
          :disabled="model.pageDisabled"
          :options="roles"
          :label="messages.applicationModeRole"
          :placeholder="messages.applicationModeUnassigned"
          data-property="application-page-role"
          @update:model-value="model.setRole"
        />
      </div>
      <div class="space-y-1">
        <div class="flex items-center justify-between gap-1">
          <label :for="`${id}-entry`" class="text-[11px] text-muted">{{
            messages.applicationModeEntry
          }}</label>
          <IconButton
            v-if="model.entryId"
            :disabled="model.entryDisabled"
            :label="`${common.clear}: ${messages.applicationModeEntry}`"
            data-command="application-entry-clear"
            @click="model.setEntry('')"
            ><icon-lucide-rotate-ccw class="size-3"
          /></IconButton>
        </div>
        <AppSelect
          :key="`entry-${model.version}`"
          :id="`${id}-entry`"
          :model-value="model.entryId"
          :disabled="model.entryDisabled"
          :options="entries"
          :label="messages.applicationModeEntry"
          :placeholder="messages.applicationModeChooseEntry"
          data-property="application-entry-frame"
          @update:model-value="model.setEntry"
        />
      </div>
      <div class="space-y-1">
        <label :for="`${id}-route`" class="text-[11px] text-muted">{{
          messages.applicationModeRoute
        }}</label>
        <RouteField
          :id="`${id}-route`"
          :model-value="model.route"
          :version="model.version"
          :disabled="model.routeDisabled"
          :label="messages.applicationModeRoute"
          data-property="application-route"
          @commit="model.setRoute"
        />
      </div>
      <div v-if="model.role === 'application'" class="space-y-1">
        <label :for="`${id}-retention`" class="text-[11px] text-muted">{{
          messages.applicationStateRetention
        }}</label>
        <AppSelect
          :key="`retention-${model.version}`"
          :id="`${id}-retention`"
          :model-value="model.stateRetention"
          :disabled="model.stateRetentionDisabled"
          :options="stateRetentions"
          :label="messages.applicationStateRetention"
          :placeholder="messages.applicationStateRetentionUnset"
          :aria-describedby="`${id}-retention-hint`"
          data-property="application-state-retention"
          @update:model-value="model.setStateRetention"
        />
        <p :id="`${id}-retention-hint`" class="text-[10px] leading-relaxed text-muted">
          {{ messages.applicationStateRetentionHint }}
        </p>
      </div>
      <div class="space-y-1">
        <div class="flex items-center justify-between gap-1">
          <label :for="`${id}-start`" class="text-[11px] text-muted">{{
            messages.applicationModeStart
          }}</label>
          <IconButton
            v-if="model.startId"
            :disabled="model.startDisabled"
            :label="`${common.clear}: ${messages.applicationModeStart}`"
            data-command="application-start-clear"
            @click="model.setStart('')"
            ><icon-lucide-rotate-ccw class="size-3"
          /></IconButton>
        </div>
        <AppSelect
          :key="`start-${model.version}`"
          :id="`${id}-start`"
          :model-value="model.startId"
          :disabled="model.startDisabled"
          :options="starts"
          :label="messages.applicationModeStart"
          :placeholder="messages.applicationModeChooseStart"
          :aria-invalid="model.startRouteInvalid || undefined"
          :aria-describedby="model.startRouteInvalid ? `${id}-start-error` : undefined"
          data-property="application-start-page"
          @update:model-value="model.setStart"
        />
        <AppAlert
          v-if="model.startRouteInvalid"
          :id="`${id}-start-error`"
          tone="warning"
          :heading="messages.applicationModeStart"
          :description="messages.applicationModeStartInvalid"
          data-test-id="application-start-route-invalid"
        />
      </div>
      <p class="text-[10px] leading-relaxed text-muted">
        {{ messages.applicationModeConfigureHint }}
      </p>
      <template v-if="model.role === 'application'">
        <GuardSettings :model="model.enter" />
        <GuardSettings :model="model.leave" />
      </template>
      <ShellSettings :model="model.shell" />
    </div>
  </section>
</template>
