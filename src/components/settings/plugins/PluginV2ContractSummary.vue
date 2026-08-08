<script setup lang="ts">
import type { PluginV2ContractSummary } from '@/app/plugins/settings-view-model'

const { contracts, versionLabel, scope } = defineProps<{
  contracts: readonly PluginV2ContractSummary[]
  versionLabel: string
  scope: 'catalog' | 'current' | 'pending'
}>()

function permissionsText(contract: PluginV2ContractSummary): string {
  return contract.permissions.length ? contract.permissions.join(', ') : '[]'
}

function outputsText(contract: PluginV2ContractSummary): string {
  return contract.outputs.length
    ? contract.outputs.map(({ extension, mimeType }) => `${extension} (${mimeType})`).join(', ')
    : '[]'
}
</script>

<template>
  <section
    class="rounded border border-border/70 bg-panel px-2 py-1.5 text-[9px] text-muted"
    :data-test-id="`plugin-v2-contract-${scope}`"
  >
    <p class="font-medium text-surface">{{ versionLabel }}</p>
    <p v-if="contracts.length === 0" class="mt-1 font-mono">contracts: []</p>
    <div
      v-for="contract in contracts"
      :key="`${contract.kind}:${contract.contributionId}`"
      class="mt-1 border-t border-border/60 pt-1 first:border-t-0 first:pt-0"
    >
      <p class="break-all font-mono text-surface">
        {{ contract.kind }}:{{ contract.contributionId }}
      </p>
      <p class="break-words font-mono">permissions: {{ permissionsText(contract) }}</p>
      <p v-if="contract.kind === 'exporter'" class="break-words font-mono">
        outputs: {{ outputsText(contract) }}
      </p>
      <p class="font-mono">
        parameters.maxBytes: {{ contract.parameterMaxBytes }} B · result.maxBytes:
        {{ contract.resultMaxBytes }} B
      </p>
    </div>
  </section>
</template>
