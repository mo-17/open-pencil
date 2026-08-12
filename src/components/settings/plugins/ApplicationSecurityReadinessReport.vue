<script setup lang="ts">
import { computed } from 'vue'

import { parsePluginObjectParameterValue } from '@open-pencil/core/plugins'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'
import { useI18n } from '@open-pencil/vue'

import {
  APPLICATION_SECURITY_READINESS_RESULT,
  type ApplicationSecurityReadinessFinding,
  type ApplicationSecurityReadinessResult,
  type ApplicationSecurityReadinessSummary
} from '@/app/plugins/host/application-security-readiness'
import AppBadge from '@/components/ui/AppBadge.vue'

const { data } = defineProps<{ data?: JSONValue }>()
const { locale } = useI18n()

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isSecurityFinding(value: unknown): value is ApplicationSecurityReadinessFinding {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.category === 'string' &&
    (value.severity === 'error' || value.severity === 'warning') &&
    typeof value.title === 'string' &&
    typeof value.remediation === 'string' &&
    isNonNegativeInteger(value.occurrences)
  )
}

function isSecuritySummary(value: unknown): value is ApplicationSecurityReadinessSummary {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.visitedNodeCount) &&
    isNonNegativeInteger(value.visitedActionCount) &&
    isNonNegativeInteger(value.clientEndpointCount) &&
    isNonNegativeInteger(value.authGuardedPageCount) &&
    typeof value.usesSupabase === 'boolean' &&
    isNonNegativeInteger(value.serverWorkflowCount) &&
    isNonNegativeInteger(value.rlsResourceCount) &&
    isNonNegativeInteger(value.serverEnvironmentBindingCount)
  )
}

function isSecurityReadinessResult(value: unknown): value is ApplicationSecurityReadinessResult {
  return (
    isRecord(value) &&
    value.kind === 'application-security-readiness' &&
    value.scope === 'document' &&
    typeof value.pluginId === 'string' &&
    typeof value.commandId === 'string' &&
    value.environment === 'production' &&
    (value.status === 'pass' || value.status === 'review' || value.status === 'blocked') &&
    isNonNegativeInteger(value.errorCount) &&
    isNonNegativeInteger(value.warningCount) &&
    isNonNegativeInteger(value.findingCount) &&
    typeof value.truncated === 'boolean' &&
    isSecuritySummary(value.summary) &&
    Array.isArray(value.findings) &&
    value.findings.every(isSecurityFinding) &&
    Array.isArray(value.notEvaluated) &&
    value.notEvaluated.every((entry) => typeof entry === 'string') &&
    typeof value.disclaimer === 'string'
  )
}

const report = computed<ApplicationSecurityReadinessResult | null>(() => {
  if (!isRecord(data) || data.kind !== 'application-security-readiness') return null
  try {
    const parsed = parsePluginObjectParameterValue(
      data,
      APPLICATION_SECURITY_READINESS_RESULT.schema,
      APPLICATION_SECURITY_READINESS_RESULT.maxBytes,
      'Application security readiness report'
    )
    return isSecurityReadinessResult(parsed) ? parsed : null
  } catch {
    return null
  }
})

const copy = computed(() =>
  locale.value === 'zh-CN'
    ? {
        title: '应用安全就绪检查',
        pass: '通过静态检查',
        review: '需要复核',
        blocked: '部署前需处理',
        errors: '错误',
        warnings: '警告',
        nodes: '已检查节点',
        actions: '已检查动作',
        endpoints: '客户端端点',
        workflows: '服务端工作流',
        occurrences: '出现次数',
        notEvaluated: '本次静态检查未覆盖'
      }
    : {
        title: 'Application Security Readiness',
        pass: 'Static checks passed',
        review: 'Review required',
        blocked: 'Resolve before deployment',
        errors: 'Errors',
        warnings: 'Warnings',
        nodes: 'Nodes checked',
        actions: 'Actions checked',
        endpoints: 'Client endpoints',
        workflows: 'Server workflows',
        occurrences: 'Occurrences',
        notEvaluated: 'Not evaluated by this static review'
      }
)

function statusLabel(value: ApplicationSecurityReadinessResult['status']): string {
  return copy.value[value]
}

function statusTone(
  value: ApplicationSecurityReadinessResult['status']
): 'success' | 'warning' | 'error' {
  if (value === 'pass') return 'success'
  return value === 'review' ? 'warning' : 'error'
}
</script>

<template>
  <section
    v-if="report"
    class="rounded border border-border bg-panel-field px-2.5 py-2 text-[10px]"
    data-test-id="application-security-readiness-report"
    aria-live="polite"
  >
    <div class="flex items-center justify-between gap-2">
      <h4 class="font-semibold text-surface">{{ copy.title }}</h4>
      <AppBadge :tone="statusTone(report.status)">{{ statusLabel(report.status) }}</AppBadge>
    </div>

    <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-muted sm:grid-cols-4">
      <div>
        <dt>{{ copy.errors }}</dt>
        <dd class="font-medium text-surface">{{ report.errorCount }}</dd>
      </div>
      <div>
        <dt>{{ copy.warnings }}</dt>
        <dd class="font-medium text-surface">{{ report.warningCount }}</dd>
      </div>
      <div>
        <dt>{{ copy.nodes }}</dt>
        <dd class="font-medium text-surface">{{ report.summary.visitedNodeCount }}</dd>
      </div>
      <div>
        <dt>{{ copy.actions }}</dt>
        <dd class="font-medium text-surface">{{ report.summary.visitedActionCount }}</dd>
      </div>
      <div>
        <dt>{{ copy.endpoints }}</dt>
        <dd class="font-medium text-surface">{{ report.summary.clientEndpointCount }}</dd>
      </div>
      <div>
        <dt>{{ copy.workflows }}</dt>
        <dd class="font-medium text-surface">{{ report.summary.serverWorkflowCount }}</dd>
      </div>
    </dl>

    <ul v-if="report.findings.length" class="mt-2 space-y-1.5">
      <li
        v-for="finding in report.findings"
        :key="finding.code"
        class="rounded border border-border/70 px-2 py-1.5"
      >
        <div class="flex items-start justify-between gap-2">
          <p class="font-medium text-surface">{{ finding.title }}</p>
          <AppBadge :tone="finding.severity === 'error' ? 'error' : 'warning'">
            {{ finding.severity }} · {{ copy.occurrences }} {{ finding.occurrences }}
          </AppBadge>
        </div>
        <p class="mt-0.5 text-muted">{{ finding.remediation }}</p>
      </li>
    </ul>

    <details class="mt-2 text-muted">
      <summary class="cursor-pointer text-surface">{{ copy.notEvaluated }}</summary>
      <ul class="mt-1 list-disc space-y-0.5 pl-4">
        <li v-for="item in report.notEvaluated" :key="item">{{ item }}</li>
      </ul>
    </details>
    <p class="mt-2 text-muted">{{ report.disclaimer }}</p>
  </section>
</template>
