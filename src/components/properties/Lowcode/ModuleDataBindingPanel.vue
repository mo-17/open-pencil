<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { moduleDataBindingCopy } from '@/app/lowcode/value-controls/data/copy'
import { useModuleDataBinding } from '@/app/lowcode/value-controls/data/use'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { owner, rows, panels, bind } = useModuleDataBinding()
const { locale } = useI18n()
const copy = computed(() => moduleDataBindingCopy(locale.value))
</script>

<template>
  <fieldset
    v-for="row in rows"
    :key="row.version"
    class="mb-3 space-y-2"
    data-property="module-data-bindings"
  >
    <legend class="mb-1 text-[11px] font-medium text-surface">
      {{ panels.lowcodeTextSourceBound }}
    </legend>
    <AppSelect
      :data-owner-id="owner?.id"
      :model-value="row.selected"
      :label="copy[row.key]"
      :options="[
        ...(row.selected === 'invalid'
          ? [{ value: 'invalid', label: panels.lowcodeValueBindingInvalid, disabled: true }]
          : []),
        { value: 'uncontrolled', label: copy.configured },
        ...row.options
      ]"
      @update:model-value="bind($event, row.version)"
    />
    <p class="text-[10px] leading-relaxed text-muted">
      {{ row.key === 'rows' ? copy.rowsHint : copy.dataHint }}
    </p>
  </fieldset>
</template>
