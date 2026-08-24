<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle
} from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import {
  appPluginAIAuthorization,
  appPluginAIAuthorizationSnapshot,
  type InstalledAppPlugin,
  type ThirdPartyPluginAIContributionReview
} from '@/app/plugins'
import { localizedAppPluginContributionText } from '@/app/plugins/localization'
import AppBadge from '@/components/ui/AppBadge.vue'
import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'

type PendingReview = Readonly<{
  action: 'grant' | 'revoke'
  review: ThirdPartyPluginAIContributionReview
}>

const { plugin } = defineProps<{ plugin: InstalledAppPlugin }>()
const { dialogs, locale } = useI18n()
const pending = ref<PendingReview | null>(null)
const operationError = ref<string | null>(null)

const reviews = computed(() =>
  appPluginAIAuthorization.listReviews(plugin.package.manifest.plugin.id)
)
const grants = computed(() => appPluginAIAuthorizationSnapshot.value)
const pendingReview = computed(() => pending.value?.review ?? null)
const pendingScope = computed(() => {
  const review = pendingReview.value
  return review ? scopeLabel(review) : null
})

function sameAuthority(
  left: ThirdPartyPluginAIContributionReview,
  right: ThirdPartyPluginAIContributionReview
): boolean {
  if (
    left.pluginId !== right.pluginId ||
    left.kind !== right.kind ||
    left.contributionId !== right.contributionId ||
    left.adapterId !== right.adapterId ||
    left.packageDigest !== right.packageDigest ||
    left.pluginVersion !== right.pluginVersion ||
    left.publisherId !== right.publisherId ||
    left.publisherKeyId !== right.publisherKeyId
  ) {
    return false
  }
  if (left.kind !== 'connector') return true
  return (
    right.kind === 'connector' &&
    left.connectorId === right.connectorId &&
    left.operationId === right.operationId
  )
}

function grantActive(review: ThirdPartyPluginAIContributionReview): boolean {
  return grants.value.some((grant) => sameAuthority(grant, review))
}

function manifestForReview(review: ThirdPartyPluginAIContributionReview) {
  const accepted = plugin.installedState?.accepted
  const manifest = accepted?.manifest
  if (
    !accepted ||
    manifest?.schemaVersion !== 2 ||
    accepted.verifiedDigest !== review.packageDigest ||
    accepted.verifiedKeyId !== review.publisherKeyId ||
    manifest.plugin.id !== review.pluginId ||
    manifest.plugin.version !== review.pluginVersion ||
    manifest.publisher.id !== review.publisherId
  ) {
    return undefined
  }
  return manifest
}

function contributionName(review: ThirdPartyPluginAIContributionReview): string {
  const manifest = manifestForReview(review)
  if (!manifest) return review.contributionId
  if (review.kind === 'command') {
    const contribution = manifest.contributions.commands?.find(
      (candidate) =>
        candidate.commandId === review.contributionId && candidate.adapterId === review.adapterId
    )
    return (
      localizedAppPluginContributionText(review.pluginId, review.contributionId, locale.value)
        ?.name ??
      contribution?.name ??
      review.contributionId
    )
  }
  const operation = manifest.contributions.connectors
    ?.find(
      (candidate) =>
        candidate.connectorId === review.connectorId && candidate.adapterId === review.adapterId
    )
    ?.operations.find((candidate) => candidate.operationId === review.operationId)
  return (
    localizedAppPluginContributionText(review.pluginId, review.operationId, locale.value)?.name ??
    operation?.name ??
    review.operationId
  )
}

function kindLabel(review: ThirdPartyPluginAIContributionReview): string {
  return review.kind === 'command'
    ? dialogs.value.pluginAIAccessCommandKind
    : dialogs.value.pluginAIAccessConnectorKind
}

function actionLabel(review: ThirdPartyPluginAIContributionReview): string {
  const action = grantActive(review)
    ? dialogs.value.pluginAIAccessRevoke
    : dialogs.value.pluginAIAccessReview
  return `${action}: ${contributionName(review)} (${review.contributionId})`
}

function scopeLabel(review: ThirdPartyPluginAIContributionReview): string | null {
  const manifest = manifestForReview(review)
  if (!manifest) return null
  if (review.kind === 'connector') {
    const contribution = manifest.contributions.connectors?.find(
      (candidate) =>
        candidate.connectorId === review.connectorId && candidate.adapterId === review.adapterId
    )
    const operation = contribution?.operations.find(
      (candidate) => candidate.operationId === review.operationId && candidate.kind === 'query'
    )
    const request = operation?.request
    if (!request) return null
    const origin = request.origin ?? request.originTemplate
    return origin
      ? `${dialogs.value.pluginAIAccessConnectorKind} · ${request.method} ${origin}${request.pathTemplate}`
      : `${dialogs.value.pluginAIAccessConnectorKind} · ${request.method} ${request.pathTemplate}`
  }
  const permissions = manifest.contributions.commands?.find(
    (candidate) =>
      candidate.commandId === review.contributionId && candidate.adapterId === review.adapterId
  )?.permissions
  return permissions?.length
    ? permissions.join(', ')
    : dialogs.value.pluginAIAccessNoHostPermissions
}

function errorReason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function openReview(
  action: PendingReview['action'],
  review: ThirdPartyPluginAIContributionReview
): void {
  operationError.value = null
  try {
    pending.value = {
      action,
      review: appPluginAIAuthorization.review(review)
    }
  } catch (cause) {
    operationError.value = errorReason(cause)
  }
}

function updateDialogOpen(open: boolean): void {
  if (!open) pending.value = null
}

function confirmReview(): void {
  const value = pending.value
  if (!value) return
  operationError.value = null
  try {
    if (value.action === 'grant') appPluginAIAuthorization.grant(value.review)
    else appPluginAIAuthorization.revoke(value.review)
    pending.value = null
  } catch (cause) {
    pending.value = null
    operationError.value = errorReason(cause)
  }
}
</script>

<template>
  <section
    v-if="reviews.length"
    class="mt-3 rounded border border-border bg-input/20 p-2.5"
    :data-test-id="`plugin-ai-access-${plugin.package.manifest.plugin.id}`"
  >
    <div class="min-w-0">
      <h5 class="text-[10px] font-medium text-surface">
        {{ dialogs.pluginAIAccess }}
      </h5>
      <p class="mt-0.5 text-[9px] leading-relaxed text-muted">
        {{ dialogs.pluginAIAccessDescription }}
      </p>
    </div>

    <div class="mt-2 space-y-1 rounded border border-border bg-panel/60 px-2 py-1.5 text-[9px]">
      <p class="text-surface">{{ dialogs.pluginAIAccessApprovalRequired }}</p>
      <p class="text-muted">{{ dialogs.pluginAIAccessSessionOnly }}</p>
    </div>

    <div class="mt-2 grid gap-1.5" aria-live="polite">
      <div
        v-for="review in reviews"
        :key="`${review.kind}:${review.contributionId}`"
        class="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-panel px-2 py-2"
        :data-test-id="`plugin-ai-contribution-${review.kind}-${review.contributionId}`"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <p class="text-[10px] font-medium text-surface">
              {{ contributionName(review) }}
            </p>
            <AppBadge :tone="grantActive(review) ? 'success' : 'neutral'">
              {{
                grantActive(review) ? dialogs.pluginAIAccessGranted : dialogs.pluginAIAccessEligible
              }}
            </AppBadge>
          </div>
          <p class="mt-1 break-all text-[9px] text-muted">
            {{ kindLabel(review) }} · {{ review.contributionId }} · {{ review.adapterId }}
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded border px-2 py-1 text-[9px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          :class="
            grantActive(review)
              ? 'border-error/30 text-error hover:bg-error/10'
              : 'border-accent/40 bg-accent text-white hover:bg-accent/90'
          "
          :data-test-id="`plugin-ai-${grantActive(review) ? 'revoke' : 'review'}-${review.kind}-${review.contributionId}`"
          :aria-label="actionLabel(review)"
          @click="openReview(grantActive(review) ? 'revoke' : 'grant', review)"
        >
          {{ grantActive(review) ? dialogs.pluginAIAccessRevoke : dialogs.pluginAIAccessReview }}
        </button>
      </div>
    </div>

    <p v-if="operationError" class="mt-2 text-[9px] text-error" role="alert">
      {{ dialogs.pluginAIAccessOperationFailed({ reason: operationError }) }}
    </p>
  </section>

  <AppAlertDialogRoot
    :open="pending !== null"
    size="md"
    data-test-id="plugin-ai-access-review-dialog"
    @update:open="updateDialogOpen"
  >
    <header class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{
          pending?.action === 'revoke'
            ? dialogs.pluginAIAccessRevokeTitle
            : dialogs.pluginAIAccessGrantTitle
        }}
      </AlertDialogTitle>
      <AlertDialogDescription class="mt-1 text-[11px] leading-4 text-muted">
        {{
          pending?.action === 'revoke'
            ? dialogs.pluginAIAccessRevokeDescription
            : dialogs.pluginAIAccessGrantDescription
        }}
      </AlertDialogDescription>
    </header>
    <AppDialogBody v-if="pendingReview" class="space-y-3">
      <ul class="space-y-1 rounded border border-border bg-input/30 p-2.5 text-[10px] text-muted">
        <li class="break-all text-surface">
          {{
            dialogs.pluginAIAccessPackageAuthority({
              pluginId: pendingReview.pluginId,
              pluginVersion: pendingReview.pluginVersion,
              packageDigest: pendingReview.packageDigest
            })
          }}
        </li>
        <li class="break-all">
          {{
            dialogs.pluginAIAccessPublisherAuthority({
              publisherId: pendingReview.publisherId,
              publisherKeyId: pendingReview.publisherKeyId
            })
          }}
        </li>
        <li class="break-all">
          {{
            dialogs.pluginAIAccessContributionAuthority({
              kind: kindLabel(pendingReview),
              contributionId: pendingReview.contributionId
            })
          }}
        </li>
        <li class="break-all">
          {{ dialogs.pluginAIAccessAdapterAuthority({ adapterId: pendingReview.adapterId }) }}
        </li>
        <li v-if="pendingScope" class="break-all">
          {{ dialogs.pluginAIAccessScopeAuthority({ scope: pendingScope }) }}
        </li>
        <li v-if="pendingReview.kind === 'connector'" class="break-all">
          {{
            dialogs.pluginAIAccessConnectorAuthority({
              connectorId: pendingReview.connectorId,
              operationId: pendingReview.operationId
            })
          }}
        </li>
      </ul>
      <div class="space-y-1 rounded border border-warning/30 bg-warning/5 p-2.5 text-[10px]">
        <p class="text-surface">{{ dialogs.pluginAIAccessApprovalRequired }}</p>
        <p class="text-muted">{{ dialogs.pluginAIAccessSessionOnly }}</p>
      </div>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button
          type="button"
          class="rounded border border-border px-3 py-1.5 text-[11px] text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <button
          type="button"
          class="rounded px-3 py-1.5 text-[11px] font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          :class="pending?.action === 'revoke' ? 'bg-danger' : 'bg-accent'"
          data-test-id="plugin-ai-access-confirm"
          @click="confirmReview"
        >
          {{
            pending?.action === 'revoke'
              ? dialogs.pluginAIAccessRevokeConfirm
              : dialogs.pluginAIAccessGrantConfirm
          }}
        </button>
      </AlertDialogAction>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
