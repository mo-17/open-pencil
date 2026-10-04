<script setup lang="ts">
import { useStepperBindings } from '@/app/lowcode/value-controls/stepper/use'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppSwitch from '@/components/ui/toggle/AppSwitch.vue'

const { owner, rows, panels, bind, control } = useStepperBindings()
</script>

<template>
  <fieldset
    v-for="row in rows"
    :key="row.version"
    class="mb-3 space-y-2"
    data-property="stepper-bindings"
  >
    <legend class="mb-1 text-[11px] font-medium text-surface">
      {{ panels.lowcodeStepperBindings }}
    </legend>
    <AppSelect
      :data-owner-id="owner?.id"
      :model-value="row.selected"
      :label="panels.lowcodeStepperCurrentIndex"
      :options="[
        ...(row.selected === 'invalid'
          ? [{ value: 'invalid', label: panels.lowcodeValueBindingInvalid, disabled: true }]
          : []),
        { value: 'uncontrolled', label: panels.lowcodeStepperConfiguredValue },
        ...row.options
      ]"
      @update:model-value="bind($event, row.version)"
    />
    <div class="flex items-center justify-between gap-2 text-[11px] text-muted">
      <span>{{ panels.lowcodeControlDisabled }}</span>
      <AppSwitch
        :label="panels.lowcodeControlDisabled"
        :model-value="row.disabled"
        @update:model-value="control('disabled', $event, row.version)"
      />
    </div>
    <div class="flex items-center justify-between gap-2 text-[11px] text-muted">
      <span>{{ panels.lowcodeControlReadOnly }}</span>
      <AppSwitch
        :label="panels.lowcodeControlReadOnly"
        :model-value="row.readOnly"
        @update:model-value="control('readOnly', $event, row.version)"
      />
    </div>
    <p class="text-[10px] leading-relaxed text-muted">{{ panels.lowcodeStepperBindingHint }}</p>
  </fieldset>
</template>
