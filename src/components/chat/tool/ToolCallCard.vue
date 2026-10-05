<script setup lang="ts">
import { getToolName } from 'ai'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { computed, defineAsyncComponent, ref } from 'vue'

import { useI18n } from '@open-pencil/vue'

import {
  displayedToolOutput,
  toolDisplayName,
  toolErrorText,
  toolHasInput,
  toolImage,
  toolNodeIds,
  toolSource,
  toolSummary,
  type ToolCallPart
} from '@/app/ai/chat/tool-calls/display'
import { toolState } from '@/app/ai/chat/tool-presentation'
import { remoteMCPToolServerDisplayInfo } from '@/app/ai/mcp'
import { readToolChange } from '@/app/ai/tools/changes/store'
import ToolChangeView from '@/components/chat/tool/ToolChangeView.vue'
import ToolNodeChips from '@/components/chat/tool/ToolNodeChips.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import SegmentedControl from '@/components/ui/select/SegmentedControl.vue'
import { chatToolTheme } from '@/theme/chat/tool'
import { collapsibleContentMotion } from '@/theme/collapsible/collapsible'

// CodeMirror loads with the first expanded call, not with the chat panel.
const CodeViewer = defineAsyncComponent(() => import('@/components/code-editor/CodeViewer.vue'))

const {
  part,
  pendingApprovalIds = [],
  approvalEnabled = false
} = defineProps<{
  part: ToolCallPart
  pendingApprovalIds?: readonly string[]
  approvalEnabled?: boolean
}>()
const emit = defineEmits<{ toolApproval: [id: string, approved: boolean] }>()
const { ai, dialogs } = useI18n()
const remoteServer = computed(() => remoteMCPToolServerDisplayInfo(getToolName(part)))
const approvalId = computed(() => (part.state === 'approval-requested' ? part.approval.id : null))
const approvalPending = computed(
  () => approvalId.value !== null && pendingApprovalIds.includes(approvalId.value)
)
function respondToApproval(approved: boolean): void {
  if (approvalEnabled && approvalId.value && !approvalPending.value)
    emit('toolApproval', approvalId.value, approved)
}
const ui = chatToolTheme()

const state = computed(() => toolState(part))
const name = computed(() => toolDisplayName(part))
const summary = computed(() => toolSummary(part))
const source = computed(() => toolSource(part))
const error = computed(() => toolErrorText(part))
const image = computed(() => toolImage(part))
const nodeIds = computed(() => (state.value === 'pending' ? [] : toolNodeIds(part)))
const hasInput = computed(() => toolHasInput(part))
const output = computed(() => displayedToolOutput(part))
// Error results such as `diff_apply`'s mismatch report stay inspectable next to the alert.
const hasOutput = computed(() => output.value !== undefined)
// Streaming source is worth watching; other pending calls have nothing to show yet.
const expandable = computed(() => state.value !== 'pending' || source.value !== null)

const change = computed(() => readToolChange(part.toolCallId))

type DetailView = 'changes' | 'input' | 'output'
const views = computed(() => {
  const available: { value: DetailView; label: string }[] = []
  if (change.value) available.push({ value: 'changes', label: ai.value.toolChanges })
  if (hasInput.value) available.push({ value: 'input', label: ai.value.toolInput })
  if (hasOutput.value) available.push({ value: 'output', label: ai.value.toolOutput })
  return available
})
const chosenView = ref<DetailView | null>(null)
// What a call changed is the most useful view; until it exists, its output, then its input.
const shownView = computed<DetailView | null>(() => {
  const available = views.value.map((option) => option.value)
  if (chosenView.value && available.includes(chosenView.value)) return chosenView.value
  if (available.includes('changes')) return 'changes'
  return available.includes('output') ? 'output' : (available[0] ?? null)
})
const viewModel = computed({
  get: () => shownView.value ?? '',
  set: (value: string) => {
    chosenView.value = views.value.find((option) => option.value === value)?.value ?? null
  }
})
const stateLabel = computed(() => {
  if (state.value === 'pending') return ai.value.toolRunning
  if (state.value === 'approval') return dialogs.value.toolApprovalRequired
  if (state.value === 'denied') return dialogs.value.denied
  if (state.value === 'cancelled') return dialogs.value.toolCancelled
  return state.value === 'done' ? ai.value.toolFinished : ai.value.toolError
})

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? ''
}
</script>

<template>
  <CollapsibleRoot
    :class="ui.root()"
    :data-tool-state="state"
    data-slot="chat-tool-call"
    data-test-id="chat-tool-call"
  >
    <CollapsibleTrigger :class="ui.trigger()" :disabled="!expandable">
      <span :class="ui.status()" :data-state="state" :aria-label="stateLabel" role="img">
        <icon-lucide-loader-circle
          v-if="state === 'pending'"
          :class="[ui.statusIcon(), 'animate-spin motion-reduce:animate-none']"
        />
        <icon-lucide-check v-else-if="state === 'done'" :class="ui.statusIcon()" />
        <icon-lucide-triangle-alert v-else :class="ui.statusIcon()" />
      </span>
      <span :class="ui.name()">{{ name }}</span>
      <span :class="ui.summary()">{{ summary }}</span>
      <icon-lucide-chevron-down v-if="expandable" :class="ui.chevron()" aria-hidden="true" />
    </CollapsibleTrigger>
    <div
      v-if="state === 'approval'"
      data-test-id="chat-tool-approval"
      class="rounded border border-amber-500/30 bg-amber-500/5 p-2"
    >
      <p v-if="remoteServer" class="mb-1 text-[9px] text-muted">
        MCP · {{ remoteServer.name }} · {{ remoteServer.origin }}
      </p>
      <pre class="max-h-40 overflow-auto rounded bg-input p-2 text-[10px] text-muted">{{
        json(part.input)
      }}</pre>
      <div class="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          data-test-id="chat-tool-deny"
          :disabled="!approvalEnabled || approvalPending"
          class="rounded px-2 py-1 text-[10px] text-muted hover:bg-hover disabled:opacity-50"
          @click="respondToApproval(false)"
        >
          {{ dialogs.toolDeny }}
        </button>
        <button
          type="button"
          data-test-id="chat-tool-approve"
          :disabled="!approvalEnabled || approvalPending"
          class="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
          @click="respondToApproval(true)"
        >
          {{ dialogs.toolApprove }}
        </button>
      </div>
    </div>
    <CollapsibleContent :class="collapsibleContentMotion">
      <div :class="ui.body()">
        <AppAlert v-if="error" tone="error" :heading="ai.toolError" :description="error" />
        <ToolNodeChips :ids="nodeIds" />
        <SegmentedControl
          v-if="views.length > 1"
          v-model="viewModel"
          :options="views"
          :label="ai.toolDetails"
          size="sm"
        />
        <ToolChangeView v-if="shownView === 'changes' && change" :change="change" />
        <template v-else-if="shownView === 'input'">
          <CodeViewer
            v-if="source"
            :code="source.code"
            :language="source.language"
            :label="ai.toolInput"
          />
          <CodeViewer
            v-else-if="hasInput"
            :code="json(part.input)"
            language="json"
            :label="ai.toolInput"
          />
        </template>
        <img
          v-else-if="shownView === 'output' && image"
          :src="image"
          :alt="summary || name"
          :class="ui.image()"
        />
        <CodeViewer
          v-else-if="shownView === 'output'"
          :code="json(output)"
          language="json"
          :label="ai.toolOutput"
        />
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
