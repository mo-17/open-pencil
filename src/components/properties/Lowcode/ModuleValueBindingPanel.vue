<script setup lang="ts">
import { useModuleValueBindings } from '@/app/lowcode/value-controls/form/use'
import AppButton from '@/components/ui/button/AppButton.vue'
import { useSectionUI } from '@/components/ui/section'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppSwitch from '@/components/ui/toggle/AppSwitch.vue'

import InteractiveTextField from './InteractiveTextField.vue'
import ValidationFieldEditor from './ValidationFieldEditor.vue'

const section = useSectionUI()
const { mode = 'binding' } = defineProps<{ mode?: 'binding' | 'validation' }>()
const {
  owner,
  rows,
  panels,
  bind,
  readOnly,
  controlReadOnly,
  validate,
  fieldName,
  fieldNameError,
  version
} = useModuleValueBindings()
</script>

<template>
  <div
    v-if="owner"
    :key="version"
    :class="[section.wrapper, 'space-y-3']"
    :data-test-id="'module-value-' + mode"
  >
    <fieldset
      v-for="row in rows"
      :key="row.key"
      class="space-y-2"
      :data-module-value-field="row.key"
    >
      <legend class="mb-1 text-[11px] font-medium text-surface">{{ row.label }}</legend>
      <template v-if="mode === 'binding'">
        <AppSelect
          :model-value="row.selected"
          :options="row.options"
          :label="row.label"
          :data-module-binding="row.key"
          @update:model-value="bind(row.key, $event, row.version)"
        />
        <p v-if="row.options.length === 1" class="text-[10px] text-muted">
          {{ panels.lowcodeValueBindingNoStates }}
        </p>
        <span class="block text-[10px] text-muted">{{ panels.lowcodeBackendFieldName }}</span>
        <InteractiveTextField
          :model-value="row.fieldName"
          :owner="owner"
          :reset-key="row.version"
          :label="panels.lowcodeBackendFieldName"
          :placeholder="row.defaultFieldName"
          :validate-value="fieldNameError"
          :data-module-field-name="row.key"
          @commit="fieldName(row.key, $event, row.version)"
        />
        <AppButton
          v-if="row.fieldName || row.fieldNameInvalid"
          type="button"
          variant="outline"
          size="xs"
          :data-module-field-name-clear="row.key"
          @click="fieldName(row.key, '', row.version)"
          >{{ panels.lowcodeResponsiveClear }}</AppButton
        >
        <p v-if="row.fieldNameInvalid" class="text-[10px] text-danger" role="alert">
          {{ panels.lowcodeWorkflowParamInvalidIdentifier }}
        </p>
      </template>
      <template v-else>
        <ValidationFieldEditor
          :model-value="row.validation"
          :owner="owner"
          :reset-key="version"
          :value-type="row.type"
          @commit="validate(row.key, $event, row.version)"
        />
        <p
          v-if="row.selected === 'uncontrolled' || row.selected === 'invalid'"
          class="text-[10px] text-muted"
        >
          {{ panels.lowcodeValidationBindingHint }}
        </p>
      </template>
    </fieldset>
    <div
      v-if="mode === 'binding' && readOnly !== undefined"
      class="flex items-center justify-between gap-2 text-[11px] text-muted"
    >
      <span>{{ panels.lowcodeControlReadOnly }}</span>
      <AppSwitch
        :label="panels.lowcodeControlReadOnly"
        :model-value="readOnly"
        @update:model-value="controlReadOnly($event, version)"
      />
    </div>
    <p class="text-[10px] leading-relaxed text-muted">{{ panels.lowcodeModuleBindingHint }}</p>
  </div>
</template>
