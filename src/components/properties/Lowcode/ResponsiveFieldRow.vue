<script setup lang="ts">
import type { ResponsiveBreakpoint } from '@open-pencil/scene-graph'
import { usePanelMessages } from '@open-pencil/vue'

import IconButton from '@/components/ui/button/IconButton.vue'

const {
  label,
  source,
  overridden,
  disabled = false
} = defineProps<{
  label: string
  source: 'base' | ResponsiveBreakpoint
  overridden: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ restore: []; override: [] }>()
const panels = usePanelMessages()
</script>

<template>
  <div class="min-w-0 space-y-1" :data-source="source" :data-overridden="overridden">
    <div class="flex min-w-0 items-center gap-1">
      <span class="min-w-0 flex-1 truncate text-[10px] text-muted">{{ label }}</span>
      <IconButton
        :label="`${panels.lowcodeResponsiveSetOverride}: ${label}`"
        :disabled="disabled || overridden"
        data-command="author-responsive-field"
        @click="emit('override')"
      >
        <icon-lucide-pin class="size-3" />
      </IconButton>
      <IconButton
        :label="`${panels.lowcodeResponsiveRestore}: ${label}`"
        :disabled="disabled || !overridden"
        data-command="restore-responsive-field"
        @click="emit('restore')"
      >
        <icon-lucide-rotate-ccw class="size-3" />
      </IconButton>
    </div>
    <slot />
    <span
      class="block text-[10px] text-muted data-[overridden=true]:text-accent"
      :data-overridden="overridden"
      data-slot="responsive-source"
      >{{ overridden ? panels.lowcodeResponsiveOverride : panels.lowcodeResponsiveInherit }} ·
      {{ source === 'base' ? panels.lowcodeResponsiveBase : source }}
    </span>
  </div>
</template>
