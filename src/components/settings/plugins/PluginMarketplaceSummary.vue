<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@open-pencil/vue'

import { appPluginMarketplaceConfigured, appPluginMarketplaceSnapshot } from '@/app/plugins'
import { pluginMarketplaceSnapshotView } from '@/app/plugins/settings-view-model'
import AppBadge from '@/components/ui/AppBadge.vue'

const { dialogs } = useI18n()

const marketplaceVisible = computed(
  () => appPluginMarketplaceConfigured || appPluginMarketplaceSnapshot.value !== null
)
const marketplace = computed(() =>
  pluginMarketplaceSnapshotView(marketplaceVisible.value, appPluginMarketplaceSnapshot.value)
)

const statusLabel = computed(() => {
  const labels = {
    fresh: dialogs.value.pluginRemoteFresh,
    cached: dialogs.value.pluginRemoteCached,
    stale: dialogs.value.pluginRemoteStale,
    unavailable: dialogs.value.pluginRemoteUnavailable,
    loading: dialogs.value.pluginLoading,
    'not-configured': dialogs.value.pluginRemoteNotConfigured
  }
  return labels[marketplace.value.status]
})

const statusTone = computed<'neutral' | 'success' | 'warning' | 'error'>(() => {
  if (marketplace.value.status === 'fresh') return 'success'
  if (marketplace.value.status === 'stale') return 'warning'
  if (marketplace.value.status === 'unavailable') return 'error'
  return 'neutral'
})
</script>

<template>
  <section
    v-if="marketplaceVisible"
    class="rounded border border-border bg-panel-field p-3"
    data-test-id="plugin-marketplace-summary"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h4 class="text-[11px] font-medium text-surface">
          {{ dialogs.pluginMarketplace }}
        </h4>
        <p
          v-if="marketplace.marketplaceId && marketplace.version && marketplace.sequence"
          class="mt-0.5 truncate text-[9px] text-muted"
        >
          {{
            dialogs.pluginMarketplaceSnapshot({
              marketplaceId: marketplace.marketplaceId,
              version: marketplace.version,
              sequence: marketplace.sequence
            })
          }}
        </p>
      </div>
      <AppBadge :tone="statusTone" data-test-id="plugin-marketplace-status">
        {{ statusLabel }}
      </AppBadge>
    </div>

    <div v-if="marketplace.marketplaceId" class="mt-2 grid grid-cols-2 gap-2 text-[9px]">
      <div class="rounded border border-border/70 px-2 py-1.5">
        <p class="text-muted">{{ dialogs.pluginMarketplaceListings }}</p>
        <p class="mt-0.5 font-medium text-surface">{{ marketplace.listingCount }}</p>
      </div>
      <div class="rounded border border-border/70 px-2 py-1.5">
        <p class="text-muted">{{ dialogs.pluginMarketplaceRuntimeIndex }}</p>
        <p class="mt-0.5 truncate font-medium text-surface">
          {{
            marketplace.runtimeIndexId
              ? dialogs.pluginMarketplaceRuntimeIndexPresent({
                  indexId: marketplace.runtimeIndexId
                })
              : dialogs.pluginMarketplaceRuntimeIndexAbsent
          }}
        </p>
      </div>
    </div>

    <p
      v-if="marketplace.auditSequence !== null && marketplace.auditDigest"
      class="mt-2 break-all font-mono text-[9px] text-muted"
      data-test-id="plugin-marketplace-audit-head"
    >
      {{
        dialogs.pluginMarketplaceAuditHead({
          sequence: marketplace.auditSequence,
          digest: marketplace.auditDigest
        })
      }}
    </p>
    <p v-if="marketplace.runtimeIndexDigest" class="mt-1 break-all font-mono text-[9px] text-muted">
      {{ dialogs.pluginDigest({ digest: marketplace.runtimeIndexDigest }) }}
    </p>
    <p
      v-if="marketplace.refreshError"
      class="mt-2 break-words text-[9px] text-warning"
      role="alert"
    >
      {{ marketplace.refreshError.message }}
    </p>
  </section>
</template>
