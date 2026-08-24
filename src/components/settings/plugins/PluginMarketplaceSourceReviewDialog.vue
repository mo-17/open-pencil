<script setup lang="ts">
import { AlertDialogCancel, AlertDialogDescription, AlertDialogTitle } from 'reka-ui'
import { useI18n } from '@open-pencil/vue'

import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'
import type { PluginMarketplaceSourceReviewView } from './PluginMarketplaceSourceControls.vue'

const { review, busy, error, installedPublisherCount } = defineProps<{
  review: PluginMarketplaceSourceReviewView | null
  busy: boolean
  error: string | null
  installedPublisherCount: number
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const { dialogs } = useI18n()
</script>

<template>
  <AppAlertDialogRoot
    :open="review !== null"
    size="md"
    height="tall"
    data-test-id="plugin-marketplace-source-review-dialog"
    @update:open="$event ? undefined : emit('close')"
  >
    <header class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ dialogs.pluginMarketplaceSourceReviewTitle }}
      </AlertDialogTitle>
      <AlertDialogDescription class="mt-1 text-[11px] leading-4 text-muted">
        {{ dialogs.pluginMarketplaceSourceReviewDescription }}
      </AlertDialogDescription>
    </header>
    <AppDialogBody v-if="review" class="space-y-3" :aria-busy="busy">
      <dl class="grid gap-x-3 gap-y-1.5 text-[10px] sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceUrl }}</dt>
        <dd class="break-all font-mono text-surface" data-test-id="source-review-url">
          {{ review.snapshotUrl }}
        </dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceMarketplaceId }}</dt>
        <dd class="break-all font-mono text-surface">{{ review.marketplaceId }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceChannel }}</dt>
        <dd class="text-surface">{{ review.channel }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceRootKey }}</dt>
        <dd class="break-all font-mono text-surface">{{ review.rootKeyId }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceRootFingerprint }}</dt>
        <dd class="break-all font-mono text-surface" data-test-id="source-review-fingerprint">
          {{ review.rootFingerprint }}
        </dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceSnapshotVersion }}</dt>
        <dd class="font-mono text-surface">{{ review.snapshotVersion }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceSnapshotSequence }}</dt>
        <dd class="font-mono text-surface">{{ review.snapshotSequence }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceSnapshotDigest }}</dt>
        <dd class="break-all font-mono text-surface" data-test-id="source-review-digest">
          {{ review.snapshotDigest }}
        </dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceSnapshotExpiry }}</dt>
        <dd class="break-all font-mono text-surface">{{ review.expiresAt }}</dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceAuditHead }}</dt>
        <dd class="break-all font-mono text-surface">
          #{{ review.auditSequence }} · {{ review.auditHeadDigest }}
        </dd>
        <dt class="text-muted">{{ dialogs.pluginMarketplaceSourceListingCount }}</dt>
        <dd class="font-mono text-surface">{{ review.listingCount }}</dd>
        <dt class="text-muted">{{ dialogs.pluginPackageReviewCatalog }}</dt>
        <dd class="break-all font-mono text-surface" data-test-id="source-review-catalog">
          {{
            dialogs.pluginPackageReviewCatalogAuthority({
              catalogId: review.catalogId,
              version: review.catalogVersion,
              digest: review.catalogDigest
            })
          }}
        </dd>
      </dl>

      <p
        v-if="review.isRootRotation"
        class="rounded border border-warning/30 bg-warning/5 p-2 text-[9px] leading-4 text-warning"
        data-test-id="plugin-marketplace-source-root-rotation"
        role="status"
      >
        {{ dialogs.pluginMarketplaceSourceRootRotation }}
      </p>
      <p
        v-if="review.requiresStrictAdvance"
        class="rounded border border-border bg-input/20 p-2 text-[9px] leading-4 text-muted"
      >
        {{ dialogs.pluginMarketplaceSourceStrictAdvance }}
      </p>
      <p
        v-if="installedPublisherCount > 0"
        class="rounded border border-warning/30 bg-warning/5 p-2 text-[9px] leading-4 text-warning"
        role="status"
      >
        {{ dialogs.pluginMarketplaceSourceInstalledBlocker({ count: installedPublisherCount }) }}
      </p>
      <p
        v-if="error"
        class="rounded border border-error/30 bg-error/5 p-2 text-[10px] text-error"
        role="alert"
        aria-live="assertive"
      >
        {{ error }}
      </p>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          :disabled="busy"
          data-test-id="plugin-marketplace-source-review-cancel"
        >
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <button
        type="button"
        class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="busy || installedPublisherCount > 0"
        data-test-id="plugin-marketplace-source-review-confirm"
        @click="emit('confirm')"
      >
        {{
          busy ? dialogs.pluginMarketplaceSourceActivating : dialogs.pluginMarketplaceSourceActivate
        }}
      </button>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
