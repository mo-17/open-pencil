<script setup lang="ts">
import { computed } from 'vue'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'
import { useI18n } from '@open-pencil/vue'

interface ExportWarningView {
  code: string
  message: string
  nodeId?: string
}

interface ExportResultView {
  fileName: string
  fileCount: number
  warningCount: number
  warnings: ExportWarningView[]
  warningsTruncated: boolean
}

const { data } = defineProps<{ data?: JSONValue }>()
const { dialogs } = useI18n()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum
}

function exportWarning(value: unknown): ExportWarningView | null {
  if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') {
    return null
  }
  return {
    code: value.code.slice(0, 256),
    message: value.message.slice(0, 2_048),
    ...(typeof value.nodeId === 'string' ? { nodeId: value.nodeId.slice(0, 256) } : {})
  }
}

function exportResult(value: unknown): ExportResultView | null {
  if (
    !isRecord(value) ||
    value.kind !== 'plugin-export' ||
    typeof value.fileName !== 'string' ||
    !boundedInteger(value.fileCount, 4_096) ||
    !boundedInteger(value.warningCount, 1_000_000) ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 100 ||
    typeof value.warningsTruncated !== 'boolean'
  ) {
    return null
  }
  const warnings: ExportWarningView[] = []
  for (const candidate of value.warnings) {
    const warning = exportWarning(candidate)
    if (!warning) return null
    warnings.push(warning)
  }
  return {
    fileName: value.fileName.slice(0, 512),
    fileCount: value.fileCount,
    warningCount: value.warningCount,
    warnings,
    warningsTruncated: value.warningsTruncated
  }
}

const result = computed(() => exportResult(data))
</script>

<template>
  <section
    v-if="result"
    class="rounded border border-border bg-panel-field px-2.5 py-2"
    data-test-id="plugin-export-result"
  >
    <p class="break-all text-[10px] font-medium text-surface">
      {{
        dialogs.pluginExportResultSummary({
          fileName: result.fileName,
          count: result.fileCount
        })
      }}
    </p>
    <div v-if="result.warningCount > 0" class="mt-2" data-test-id="plugin-export-warnings">
      <p class="text-[9px] font-medium text-warning">
        {{ dialogs.pluginExportWarnings({ count: result.warningCount }) }}
      </p>
      <ul class="mt-1 flex flex-col gap-1">
        <li
          v-for="(warning, index) in result.warnings"
          :key="`${warning.code}:${warning.nodeId ?? ''}:${index}`"
          class="rounded border border-warning/25 bg-warning/5 px-2 py-1 text-[9px] text-surface"
        >
          <span class="font-mono font-medium text-warning">{{ warning.code }}</span>
          <span v-if="warning.nodeId" class="ml-1 break-all font-mono text-muted">
            {{ warning.nodeId }}
          </span>
          <p class="mt-0.5 break-words text-muted">{{ warning.message }}</p>
        </li>
      </ul>
      <p v-if="result.warningsTruncated" class="mt-1 text-[9px] text-muted">
        {{ dialogs.pluginExportWarningsTruncated }}
      </p>
    </div>
  </section>
</template>
