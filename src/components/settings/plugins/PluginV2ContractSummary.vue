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

function joined(values: readonly string[] | undefined): string {
  return values?.length ? values.join(', ') : '[]'
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
      <p v-if="contract.kind !== 'storage-provider'" class="break-words font-mono">
        permissions: {{ permissionsText(contract) }}
      </p>
      <p v-if="contract.kind === 'exporter'" class="break-words font-mono">
        outputs: {{ outputsText(contract) }}
      </p>
      <template v-if="contract.kind === 'connector'">
        <p class="break-all font-mono">origins: {{ joined(contract.networkOrigins) }}</p>
        <p class="break-words font-mono">methods: {{ joined(contract.networkMethods) }}</p>
        <p class="break-words font-mono">credentials: {{ joined(contract.credentialSlots) }}</p>
      </template>
      <template v-if="contract.kind === 'storage-provider'">
        <p class="break-words font-mono">capabilities: {{ joined(contract.capabilities) }}</p>
        <p class="font-mono">configVersion: {{ contract.configVersion }}</p>
      </template>
      <template v-if="contract.kind === 'backend-provider'">
        <p class="break-words font-mono">capabilities: {{ joined(contract.capabilities) }}</p>
        <p class="break-words font-mono">outputKinds: {{ joined(contract.outputKinds) }}</p>
        <p class="font-mono">configuration.maxBytes: {{ contract.configurationMaxBytes }} B</p>
      </template>
      <p
        v-if="contract.kind !== 'storage-provider' && contract.kind !== 'backend-provider'"
        class="font-mono"
      >
        parameters.maxBytes: {{ contract.parameterMaxBytes }} B · result.maxBytes:
        {{ contract.resultMaxBytes }} B
      </p>
    </div>
  </section>
</template>
