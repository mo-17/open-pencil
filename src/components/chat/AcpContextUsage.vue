<script setup lang="ts">
import { computed } from 'vue'

import { useAIMessages } from '@open-pencil/vue'

import type { ACPContextUsageView } from '@/app/ai/acp/context-usage'
import { contextUsageTheme } from '@/theme/chat/context-usage'

const { usage } = defineProps<{ usage: ACPContextUsageView }>()
const ai = useAIMessages()
const cls = contextUsageTheme()
const summary = computed(() => {
  const value = usage
  if (value.state === 'invalid') return ai.value.contextUsageInvalid
  if (value.state === 'stale') return ai.value.contextUsageStale
  if (value.state !== 'available') return ai.value.contextUsageUnavailable
  return `${value.used?.toLocaleString()} / ${value.capacity?.toLocaleString()} (${value.percent?.toFixed(1)}%)`
})
const updatedAt = computed(() => {
  const timestamp = usage.updatedAt
  return timestamp === undefined ? '' : new Date(timestamp).toLocaleTimeString()
})
</script>

<template>
  <details :class="cls.root()">
    <summary :class="cls.summary()">{{ ai.contextWindow }} · {{ summary }}</summary>
    <div :class="cls.details()">
      <time v-if="updatedAt" :class="cls.time()">{{ ai.contextUpdated }} {{ updatedAt }}</time>
      <p>
        {{ ai.contextTokenReport }} · {{ ai.contextInput }}:
        {{ usage.inputTokens?.toLocaleString() ?? ai.contextUsageUnavailable }} ·
        {{ ai.contextOutput }}:
        {{ usage.outputTokens?.toLocaleString() ?? ai.contextUsageUnavailable }}
      </p>
      <p>{{ ai.contextTokenScope }}</p>
      <p>{{ ai.contextSkillsUnknown }}</p>
      <p>{{ ai.contextCompactionUnknown }}</p>
    </div>
  </details>
</template>
