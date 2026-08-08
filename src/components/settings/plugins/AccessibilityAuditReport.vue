<script setup lang="ts">
import { computed } from 'vue'
import type { JsonValue } from '@open-pencil/scene-graph/primitives'
import { useI18n } from '@open-pencil/vue'

import { parseStaticAccessibilityReport } from '@/app/plugins/accessibility-report'

const { data } = defineProps<{ data?: JsonValue }>()
const { dialogs } = useI18n()
const report = computed(() => parseStaticAccessibilityReport(data))

function severityClass(severity: 'error' | 'warning' | 'info'): string {
  if (severity === 'error') return 'text-danger'
  if (severity === 'warning') return 'text-warning'
  return 'text-muted'
}
</script>

<template>
  <section
    v-if="report"
    class="rounded border border-border bg-secondary p-2"
    data-test-id="plugin-accessibility-report"
  >
    <h4 class="text-[11px] font-medium text-surface">
      {{ dialogs.pluginAccessibilityReportTitle }}
    </h4>
    <p class="mt-0.5 text-[9px] text-muted">
      {{
        dialogs.pluginAccessibilityReportCounts({
          errors: report.errorCount,
          warnings: report.warningCount,
          info: report.infoCount
        })
      }}
    </p>

    <p v-if="report.issueCount === 0" class="mt-2 text-[10px] text-success">
      {{ dialogs.pluginAccessibilityReportNoIssues }}
    </p>
    <template v-else>
      <p v-if="report.truncated" class="mt-2 text-[9px] text-muted">
        {{
          dialogs.pluginAccessibilityReportShowing({
            shown: report.issues.length,
            total: report.issueCount
          })
        }}
      </p>
      <ol class="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
        <li
          v-for="(issue, index) in report.issues"
          :key="`${issue.ruleId}:${issue.nodeId}:${index}`"
          class="rounded border border-border bg-primary p-1.5"
        >
          <div class="flex items-start justify-between gap-2">
            <span class="min-w-0 text-[10px] text-surface">{{ issue.message }}</span>
            <span
              class="shrink-0 text-[9px] font-medium uppercase"
              :class="severityClass(issue.severity)"
            >
              {{ issue.severity }}
            </span>
          </div>
          <p class="mt-0.5 truncate text-[9px] text-muted">
            {{ issue.nodeName }} · {{ issue.ruleId }}
          </p>
          <p v-if="issue.suggestion" class="mt-1 text-[9px] text-muted">
            {{ dialogs.pluginAccessibilityReportSuggestion }}: {{ issue.suggestion }}
          </p>
        </li>
      </ol>
    </template>

    <details v-if="report.notEvaluated.length" class="mt-2 text-[9px] text-muted">
      <summary class="cursor-pointer">{{ dialogs.pluginAccessibilityReportNotEvaluated }}</summary>
      <ul class="mt-1 list-disc space-y-0.5 pl-4">
        <li v-for="item in report.notEvaluated" :key="item">{{ item }}</li>
      </ul>
    </details>
  </section>
</template>
