<script setup lang="ts">
import { AlertDialogCancel, AlertDialogDescription, AlertDialogTitle } from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import type { ResolvedPluginPackage } from '@/app/plugins'
import type { PluginV2ContractSummary as PluginV2ContractSummaryModel } from '@/app/plugins/settings-view-model'
import AppBadge from '@/components/ui/AppBadge.vue'
import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'
import PluginV2ContractSummary from './PluginV2ContractSummary.vue'

interface PluginPackageReviewCurrentAuthority {
  readonly version: string
  readonly digest: string
  readonly keyId: string
}

const { open, action, pluginPackage, currentAuthority, contracts, busy, error } = defineProps<{
  open: boolean
  action: 'install' | 'update'
  pluginPackage: ResolvedPluginPackage | null
  currentAuthority?: PluginPackageReviewCurrentAuthority
  contracts: readonly PluginV2ContractSummaryModel[]
  busy: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  confirm: []
}>()

const { dialogs } = useI18n()

function catalogSourceLabel(source: 'network' | 'cache'): string {
  return source === 'network' ? dialogs.value.pluginRemoteFresh : dialogs.value.pluginRemoteCached
}

function catalogAuthorizationCurrent(): boolean {
  const remoteCatalog = pluginPackage?.remoteCatalog
  if (!remoteCatalog) return false
  const expiresAt = Date.parse(remoteCatalog.catalogExpiresAt)
  return Number.isFinite(expiresAt) && Date.now() < expiresAt
}
</script>

<template>
  <AppAlertDialogRoot
    :open="open"
    size="md"
    height="tall"
    data-test-id="plugin-package-review-dialog"
    @update:open="emit('update:open', $event)"
  >
    <header class="border-b border-border px-4 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <AlertDialogTitle class="text-sm font-semibold text-surface">
          {{
            action === 'install'
              ? dialogs.pluginPackageReviewInstallTitle
              : dialogs.pluginPackageReviewUpdateTitle
          }}
        </AlertDialogTitle>
        <AppBadge tone="warning">{{ dialogs.pluginTrustPublisher }}</AppBadge>
      </div>
      <AlertDialogDescription class="mt-1 text-[11px] leading-4 text-muted">
        {{
          action === 'install'
            ? dialogs.pluginPackageReviewInstallDescription
            : dialogs.pluginPackageReviewUpdateDescription
        }}
      </AlertDialogDescription>
    </header>

    <AppDialogBody
      v-if="pluginPackage"
      class="space-y-3"
      :aria-busy="busy"
      data-test-id="plugin-package-review-body"
    >
      <section
        v-if="currentAuthority"
        class="rounded border border-border bg-input/20 p-2.5 text-[10px]"
        data-test-id="plugin-package-review-current"
      >
        <h3 class="font-medium text-surface">{{ dialogs.pluginPackageReviewCurrent }}</h3>
        <p class="mt-1 break-all font-mono text-muted">
          {{
            dialogs.pluginPackageReviewCurrentAuthority({
              version: currentAuthority.version,
              digest: currentAuthority.digest,
              keyId: currentAuthority.keyId
            })
          }}
        </p>
      </section>

      <section
        class="rounded border border-border bg-panel p-2.5 text-[10px]"
        data-test-id="plugin-package-review-candidate"
      >
        <h3 class="font-medium text-surface">{{ dialogs.pluginPackageReviewCandidate }}</h3>
        <ul class="mt-1.5 space-y-1 text-muted">
          <li class="break-all font-mono text-surface">
            {{
              dialogs.pluginPackageReviewPackageAuthority({
                pluginId: pluginPackage.manifest.plugin.id,
                schemaVersion: pluginPackage.manifest.schemaVersion,
                version: pluginPackage.manifest.plugin.version,
                digest: pluginPackage.digest
              })
            }}
          </li>
          <li class="break-all">
            {{
              dialogs.pluginPackageReviewPublisherAuthority({
                publisherName: pluginPackage.manifest.publisher.name,
                publisherId: pluginPackage.manifest.publisher.id,
                keyId:
                  pluginPackage.verifiedPackage?.verifiedKeyId ??
                  pluginPackage.manifest.publisher.keyId
              })
            }}
          </li>
        </ul>
      </section>

      <section
        class="rounded border border-border bg-input/20 p-2.5 text-[10px]"
        data-test-id="plugin-package-review-catalog"
      >
        <div class="flex flex-wrap items-center gap-1.5">
          <h3 class="font-medium text-surface">{{ dialogs.pluginPackageReviewCatalog }}</h3>
          <AppBadge v-if="pluginPackage.remoteCatalog" tone="neutral">
            {{ catalogSourceLabel(pluginPackage.remoteCatalog.source) }}
          </AppBadge>
          <AppBadge
            v-if="pluginPackage.remoteCatalog && !catalogAuthorizationCurrent()"
            tone="error"
          >
            {{ dialogs.pluginMarketplaceStatusExpired }}
          </AppBadge>
        </div>
        <template v-if="pluginPackage.remoteCatalog">
          <p class="mt-1.5 break-all font-mono text-muted">
            {{
              dialogs.pluginPackageReviewCatalogAuthority({
                catalogId: pluginPackage.remoteCatalog.catalogId,
                version: pluginPackage.remoteCatalog.catalogVersion,
                digest: pluginPackage.remoteCatalog.catalogDigest
              })
            }}
          </p>
          <p class="mt-1 break-all text-muted">
            {{
              dialogs.pluginPackageReviewCatalogExpiry({
                expiresAt: pluginPackage.remoteCatalog.catalogExpiresAt
              })
            }}
          </p>
        </template>
        <p v-else class="mt-1.5 text-warning" role="status">
          {{ dialogs.pluginPackageReviewCatalogMissing }}
        </p>
      </section>

      <section data-test-id="plugin-package-review-contracts">
        <h3 class="mb-1.5 text-[10px] font-medium text-surface">
          {{ dialogs.pluginPackageReviewCapabilities }}
        </h3>
        <PluginV2ContractSummary
          v-if="pluginPackage.manifest.schemaVersion === 2"
          :contracts="contracts"
          :version-label="dialogs.pluginVersion({ version: pluginPackage.manifest.plugin.version })"
          scope="catalog"
        />
        <p v-else class="rounded border border-warning/30 bg-warning/5 p-2 text-[9px] text-warning">
          {{ dialogs.pluginPackageReviewLegacyContract }}
        </p>
      </section>

      <p class="rounded border border-border bg-input/20 p-2 text-[9px] text-muted">
        {{ dialogs.pluginBundleOnlyNotice }}
      </p>

      <p
        v-if="error"
        class="rounded border border-error/30 bg-error/5 p-2 text-[10px] text-error"
        data-test-id="plugin-package-review-error"
        role="alert"
        aria-live="assertive"
      >
        {{ dialogs.pluginPackageReviewOperationFailed({ reason: error }) }}
      </p>
    </AppDialogBody>

    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          :disabled="busy"
          data-test-id="plugin-package-review-cancel"
        >
          {{ dialogs.pluginPackageReviewCancel }}
        </button>
      </AlertDialogCancel>
      <button
        type="button"
        class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        :disabled="busy || !pluginPackage || !catalogAuthorizationCurrent()"
        data-test-id="plugin-package-review-confirm"
        @click="emit('confirm')"
      >
        {{
          busy
            ? action === 'install'
              ? dialogs.pluginPackageReviewInstalling
              : dialogs.pluginPackageReviewUpdating
            : action === 'install'
              ? dialogs.pluginPackageReviewConfirmInstall
              : dialogs.pluginPackageReviewConfirmUpdate
        }}
      </button>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
