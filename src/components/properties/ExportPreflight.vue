<script setup lang="ts">
import { computed, ref } from 'vue'

import { useEditorEvent, useI18n } from '@open-pencil/vue'

import { exportPreflightCopy } from '@/app/document/export/preflight/copy'
import { exportIssueMessage, inspectExportReadiness } from '@/app/document/export/preflight/inspect'
import { exportPreflightReport } from '@/app/document/export/preflight/state'
import { useEditorStore } from '@/app/editor/active-store'
import { focusNodesOnTheirPage } from '@/app/editor/selection/focus'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppDialog from '@/components/ui/dialog/AppDialog.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

const { nodeIds, format } = defineProps<{ nodeIds: readonly string[]; format: string }>()
const store = useEditorStore()
const { locale } = useI18n()
const copy = computed(() => exportPreflightCopy(locale.value))
const open = defineModel<boolean>('open', { default: false })
const graphRevision = ref(0)
useEditorEvent('graph:replaced', () => {
  graphRevision.value++
})
const report = computed(() => {
  void graphRevision.value
  void store.state.sceneVersion
  return exportPreflightReport(store.graph).value
})
const stale = computed(
  () =>
    report.value?.sceneVersion !== undefined &&
    report.value.sceneVersion !== store.state.sceneVersion
)
const otherTarget = computed(() => {
  const current = report.value
  if (!current) return false
  const roots = new Set(current.nodeIds)
  return (
    current.format !== format ||
    roots.size !== nodeIds.length ||
    nodeIds.some((id) => !roots.has(id))
  )
})
function check() {
  exportPreflightReport(store.graph).value = inspectExportReadiness(store.graph, nodeIds, {
    format,
    sceneVersion: store.state.sceneVersion,
    canRenderShaders: true,
    shaderStatus: store.getShaderFrameStatus
  })
}
function show() {
  if (!report.value || stale.value) check()
  open.value = true
}
async function locate(id: string) {
  if (stale.value || !store.graph.getNode(id)) return
  open.value = false
  await focusNodesOnTheirPage(store, [id])
}
</script>

<template>
  <AppButton size="xs" data-property="export-preflight" @click="show">
    {{ copy.title }}
  </AppButton>
  <AppDialog
    v-model:open="open"
    :heading="copy.title"
    :description="copy.note"
    :close-label="copy.close"
    size="lg"
  >
    <div v-if="report" class="flex flex-col gap-2" data-property="export-preflight-report">
      <AppAlert
        :tone="report.blockingCount ? 'error' : 'info'"
        :heading="report.blockingCount ? copy.blocked : copy.ready"
        :description="copy.summary(report.format, report.nodeCount)"
      />
      <AppAlert v-if="stale" tone="warning" :heading="copy.stale" />
      <AppAlert v-if="otherTarget" tone="info" :heading="copy.otherTarget" />
      <AppAlert v-if="report.truncated" tone="warning" :heading="copy.partial" />
      <AppAlert
        v-for="(issue, index) in report.issues"
        :key="`${issue.code}:${issue.nodeId}:${index}`"
        :tone="issue.severity"
        :heading="copy.codes[issue.code] ?? exportIssueMessage(issue)"
        :description="issue.nodeId ? store.graph.getNode(issue.nodeId)?.name : undefined"
        :data-export-issue="issue.code"
      >
        <template v-if="issue.nodeId" #actions>
          <AppButton
            size="xs"
            :disabled="stale || !store.graph.getNode(issue.nodeId)"
            @click="locate(issue.nodeId)"
            >{{ copy.locate }}</AppButton
          >
        </template>
      </AppAlert>
    </div>
    <template #footer>
      <AppButton @click="check">{{ copy.check }}</AppButton>
      <AppButton @click="open = false">{{ copy.close }}</AppButton>
    </template>
  </AppDialog>
</template>
