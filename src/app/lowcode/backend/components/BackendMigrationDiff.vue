<script setup lang="ts">
import { ref, watch } from 'vue'

import {
  planBackendMigration,
  type BackendApplicationSpecV1,
  type DataModelIR,
  type MigrationOperation,
  type MigrationPlan,
  type MigrationRiskLevel
} from '@open-pencil/lowcode/backend'
import { useI18n } from '@open-pencil/vue'

import { EMPTY_BACKEND_DATA_MODEL } from '../document'

const { application, baseline } = defineProps<{
  application?: BackendApplicationSpecV1
  baseline?: DataModelIR
}>()
const { panels } = useI18n()
const plan = ref<MigrationPlan | null>(null)
const planning = ref(false)
const error = ref('')
let generation = 0

watch(
  () => [
    application ? JSON.stringify(application.dataModel) : '',
    JSON.stringify(baseline ?? EMPTY_BACKEND_DATA_MODEL)
  ],
  async () => {
    const currentGeneration = ++generation
    plan.value = null
    error.value = ''
    if (!application) return
    planning.value = true
    try {
      const next = await planBackendMigration(
        structuredClone(baseline ?? EMPTY_BACKEND_DATA_MODEL),
        structuredClone(application.dataModel)
      )
      if (currentGeneration === generation) plan.value = next
    } catch {
      if (currentGeneration === generation)
        error.value = panels.value.lowcodeBackendMigrationInvalid
    } finally {
      if (currentGeneration === generation) planning.value = false
    }
  },
  { immediate: true }
)

function operationLabel(operation: MigrationOperation): string {
  if (operation.kind === 'create-entity') return `${operation.kind}: ${operation.entity.name}`
  if (operation.kind === 'add-field') return `${operation.kind}: ${operation.field.name}`
  if (operation.kind === 'create-enum') return `${operation.kind}: ${operation.enum.name}`
  if ('nextName' in operation) return `${operation.kind}: ${operation.nextName}`
  if ('reason' in operation) return `${operation.kind}: ${operation.reason}`
  return operation.kind
}

function riskClass(risk: MigrationRiskLevel): string {
  if (risk === 'destructive') return 'border-red-500/40 bg-red-500/10 text-red-500'
  if (risk === 'high') return 'border-orange-500/40 bg-orange-500/10 text-orange-500'
  if (risk === 'medium') return 'border-amber-500/40 bg-amber-500/10 text-amber-500'
  return 'border-green-500/40 bg-green-500/10 text-green-500'
}
</script>

<template>
  <div class="mt-2" data-test-id="lowcode-backend-migration">
    <p v-if="planning" class="text-[10px] text-muted">
      {{ panels.lowcodeBackendMigrationPlanning }}
    </p>
    <p v-else-if="error || !application" class="text-[10px] text-red-500">
      {{ error || panels.lowcodeBackendMigrationInvalid }}
    </p>
    <template v-else-if="plan">
      <div class="flex items-center gap-1 text-[10px] text-muted">
        <span>{{ panels.lowcodeBackendMigrationRisk }}</span
        ><span :class="['rounded border px-1.5 py-0.5', riskClass(plan.highestRisk)]">{{
          plan.highestRisk
        }}</span>
      </div>
      <p v-if="plan.requiresBackup" class="mt-1 text-[10px] text-orange-500">
        {{ panels.lowcodeBackendMigrationBackup }}
      </p>
      <p
        v-if="plan.highestRisk === 'destructive'"
        class="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
      >
        {{ panels.lowcodeBackendMigrationDestructive }}
      </p>
      <p v-if="plan.operations.length === 0" class="mt-1.5 text-[10px] text-muted">
        {{ panels.lowcodeBackendMigrationNoChanges }}
      </p>
      <ul v-else class="mt-1.5 flex flex-col gap-1">
        <li
          v-for="entry in plan.operations"
          :key="entry.operation.id"
          class="rounded border border-border px-2 py-1"
        >
          <div class="flex items-center gap-1">
            <span :class="['rounded border px-1 text-[9px]', riskClass(entry.risk)]">{{
              entry.risk
            }}</span
            ><span class="min-w-0 truncate font-mono text-[9px] text-surface">{{
              operationLabel(entry.operation)
            }}</span>
          </div>
          <p class="mt-0.5 text-[9px] text-muted">{{ entry.reason }}</p>
        </li>
      </ul>
    </template>
    <p v-if="application?.storage" class="mt-2 border-t border-border pt-2 text-[9px] text-muted">
      {{ panels.lowcodeBackendStorageExtension }}
    </p>
  </div>
</template>
