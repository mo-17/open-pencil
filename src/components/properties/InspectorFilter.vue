<script setup lang="ts">
const { modelValue } = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div data-test-id="inspector-filter" class="border-b border-border px-2 py-2">
    <label
      class="flex h-7 items-center gap-1.5 rounded border border-border bg-input px-2 text-muted focus-within:border-accent"
    >
      <icon-lucide-search class="size-3 shrink-0" />
      <input
        :value="modelValue"
        aria-label="Filter properties"
        data-test-id="inspector-filter-input"
        class="min-w-0 flex-1 bg-transparent text-xs text-surface outline-none placeholder:text-muted"
        placeholder="Filter properties"
        type="search"
        @input="updateValue"
      />
      <button
        v-if="modelValue"
        aria-label="Clear property filter"
        class="-mr-1 flex size-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
        data-test-id="inspector-filter-clear"
        type="button"
        @click="emit('update:modelValue', '')"
      >
        <icon-lucide-x class="size-3" />
      </button>
    </label>
  </div>
</template>
