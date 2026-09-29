<script setup lang="ts">
import { usePaginationBindings } from '@/app/lowcode/value-controls/use-pagination-bindings'

import InteractiveTextField from './InteractiveTextField.vue'

const { owner, rows, labels, panels, select, expression, generation, begin, expressionError } =
  usePaginationBindings()
</script>

<template>
  <fieldset
    v-if="owner"
    :key="generation"
    data-test-id="pagination-bindings"
    :data-pagination-generation="generation"
    class="mb-3 space-y-2"
    @focusin="begin"
    @pointerdown.capture="begin"
    @keydown.capture="begin"
  >
    <legend class="mb-1 text-[11px] font-medium text-surface">
      {{ panels.lowcodePaginationBindings }}
    </legend>
    <div v-for="row in rows" :key="row.key">
      <label class="block text-[11px] text-muted">
        {{ labels[row.key] }}
        <select
          :value="row.selected"
          :data-owner-id="owner.id"
          :data-pagination-binding="row.key"
          class="mt-1 w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="select(row.key, $event)"
        >
          <option v-if="row.selected === 'invalid'" value="invalid" disabled>
            {{ panels.lowcodeValueBindingInvalid }}
          </option>
          <option value="">{{ panels.lowcodePaginationConfiguredValue }}</option>
          <option v-if="row.key !== 'currentPage'" value="expression">
            {{ panels.lowcodeTextSourceExpression }}
          </option>
          <option v-for="option in row.options" :key="option.value" :value="option.value">
            {{
              option.scope === 'page'
                ? panels.lowcodeTextSourceBound
                : panels.lowcodeTextSourceDocState
            }}:
            {{ option.name }}
          </option>
        </select>
      </label>
      <InteractiveTextField
        v-if="row.selected === 'expression'"
        :owner="owner"
        :model-value="row.expression"
        :reset-key="generation"
        :label="labels[row.key] + ' · ' + panels.lowcodeTextSourceExpression"
        :validate-value="expressionError"
        :data-pagination-expression="row.key"
        @commit="(value, target) => expression(row.key, value, target, row.generation)"
      />
    </div>
    <p class="text-[10px] leading-relaxed text-muted">{{ panels.lowcodePaginationBindingHint }}</p>
  </fieldset>
</template>
