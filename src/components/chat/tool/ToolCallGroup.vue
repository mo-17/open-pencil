<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import type { ToolCallPart } from '@/app/ai/chat/tool-calls/display'
import { toolState } from '@/app/ai/chat/tool-presentation'
import ToolCallCard from '@/components/chat/tool/ToolCallCard.vue'
import { chatToolTheme } from '@/theme/chat/tool'
import { collapsibleContentMotion } from '@/theme/collapsible/collapsible'

/** Runs up to this long stay expanded; longer ones fold all but the latest call. */
const INLINE_CALLS = 3

const {
  parts,
  pendingApprovalIds = [],
  approvalEnabled = false
} = defineProps<{
  parts: ToolCallPart[]
  pendingApprovalIds?: readonly string[]
  approvalEnabled?: boolean
}>()
const emit = defineEmits<{ toolApproval: [id: string, approved: boolean] }>()
const hasApproval = computed(() => parts.some((part) => part.state === 'approval-requested'))
const { ai } = useI18n()
const ui = chatToolTheme()

const earlier = computed(() => parts.slice(0, -1))
const latest = computed(() => parts.at(-1))
const failed = computed(() => earlier.value.filter((part) => toolState(part) === 'error').length)
const label = computed(() => {
  const steps = ai.value.toolSteps({ count: earlier.value.length })
  return failed.value ? `${steps} · ${ai.value.toolStepsFailed({ count: failed.value })}` : steps
})
</script>

<template>
  <div v-if="parts.length <= INLINE_CALLS || hasApproval" class="space-y-1.5">
    <ToolCallCard
      v-for="part in parts"
      :key="part.toolCallId"
      :part="part"
      :pending-approval-ids="pendingApprovalIds"
      :approval-enabled="approvalEnabled"
      @tool-approval="(id, approved) => emit('toolApproval', id, approved)"
    />
  </div>
  <div v-else class="space-y-1.5">
    <CollapsibleRoot :class="ui.group()" data-slot="chat-tool-group">
      <CollapsibleTrigger :class="ui.groupTrigger()">
        <icon-lucide-list-checks :class="ui.groupIcon()" aria-hidden="true" />
        <span class="flex-1">{{ label }}</span>
        <icon-lucide-chevron-down :class="ui.chevron()" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent :class="collapsibleContentMotion">
        <div :class="ui.groupItems()">
          <ToolCallCard
            v-for="part in earlier"
            :key="part.toolCallId"
            :part="part"
            :pending-approval-ids="pendingApprovalIds"
            :approval-enabled="approvalEnabled"
            @tool-approval="(id, approved) => emit('toolApproval', id, approved)"
          />
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>
    <ToolCallCard
      v-if="latest"
      :key="latest.toolCallId"
      :part="latest"
      :pending-approval-ids="pendingApprovalIds"
      :approval-enabled="approvalEnabled"
      @tool-approval="(id, approved) => emit('toolApproval', id, approved)"
    />
  </div>
</template>
