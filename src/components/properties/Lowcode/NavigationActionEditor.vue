<script setup lang="ts">
import type { BackAction, NavigateAction } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { navigationOperation, navigationTarget } from '@/app/lowcode/action/navigation'

const { action, error } = defineProps<{ action: NavigateAction | BackAction; error?: string }>()
const emit = defineEmits<{ 'update:action': [NavigateAction | BackAction] }>()
const { panels } = useI18n()

function changeOperation(value: string): void {
  const next = navigationOperation(action, value)
  if (next) emit('update:action', next)
}

function changeTarget(value: string): void {
  emit('update:action', navigationTarget(action, value))
}
</script>

<template>
  <select
    :value="action.kind === 'back' ? 'back' : (action.history ?? 'push')"
    :aria-label="panels.lowcodeNavigationOperation"
    data-test-id="lowcode-navigation-operation"
    class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
    @change="changeOperation(($event.target as HTMLSelectElement).value)"
  >
    <option value="push">{{ panels.lowcodeNavigationJump }}</option>
    <option value="replace">{{ panels.lowcodeNavigationReplace }}</option>
    <option value="back">{{ panels.lowcodeNavigationBack }}</option>
  </select>
  <input
    :value="action.kind === 'back' ? action.fallback : (action.to ?? '')"
    :aria-label="
      action.kind === 'back' ? panels.lowcodeNavigationFallback : panels.lowcodeNavigationRoute
    "
    :aria-invalid="error ? 'true' : undefined"
    :data-test-id="action.kind === 'back' ? 'lowcode-action-fallback' : 'lowcode-action-to'"
    spellcheck="false"
    placeholder="/about"
    :class="[
      'min-w-0 flex-1 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
      error ? 'border-red-500' : 'border-border'
    ]"
    @change="changeTarget(($event.target as HTMLInputElement).value)"
  />
  <span v-if="action.kind === 'back'" class="basis-full text-[10px] text-muted">{{
    panels.lowcodeNavigationFallbackHint
  }}</span>
</template>
