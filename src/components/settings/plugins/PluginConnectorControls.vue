<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useI18n } from '@open-pencil/vue'

import {
  appConnectorAuthorization,
  appConnectorCredentialReadiness,
  appConnectorHostAdapters
} from '@/app/plugins/connectors/app'
import {
  clearConnectorCredential,
  connectorCredentialControlKey,
  connectorCredentialStatus,
  connectorCredentialStatusLabel,
  connectorOperationKindLabel,
  pluginConnectorControls,
  pluginConnectorControlsCopy,
  saveConnectorCredential,
  type PluginConnectorControl,
  type PluginConnectorCredentialControl
} from '@/app/plugins/connectors/settings-controls-model'
import type { InstalledAppPlugin } from '@/app/plugins/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import type { CredentialStatus } from '@/app/settings/credentials/types'
import AppBadge from '@/components/ui/AppBadge.vue'

import PluginConnectorOperationRunner from './PluginConnectorOperationRunner.vue'

const { plugin } = defineProps<{ plugin: InstalledAppPlugin }>()
const { locale } = useI18n()
const authorizationVersion = ref(0)
const credentialStatuses = ref<ReadonlyMap<string, CredentialStatus>>(new Map())
const busyCredentialKeys = ref<ReadonlySet<string>>(new Set())
const credentialErrors = ref<ReadonlyMap<string, string>>(new Map())
const authorizationErrors = ref<ReadonlyMap<string, string>>(new Map())
let statusRevision = 0

const copy = computed(() => pluginConnectorControlsCopy(locale.value))
const connectors = computed(() => {
  void authorizationVersion.value
  return pluginConnectorControls(plugin, appConnectorAuthorization, locale.value)
})

function credentialKey(
  connector: PluginConnectorControl,
  credential: PluginConnectorCredentialControl
): string {
  return connectorCredentialControlKey(connector.connectorId, credential.slotId)
}

function setMapValue<T>(
  source: ReadonlyMap<string, T>,
  key: string,
  value?: T
): ReadonlyMap<string, T> {
  const next = new Map(source)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  return next
}

function setBusy(key: string, busy: boolean): void {
  const next = new Set(busyCredentialKeys.value)
  if (busy) next.add(key)
  else next.delete(key)
  busyCredentialKeys.value = next
}

async function refreshCredentialStatuses(): Promise<void> {
  const revision = ++statusRevision
  const entries = connectors.value.flatMap((connector) =>
    connector.credentials.map((credential) => ({ connector, credential }))
  )
  const statuses = await Promise.all(
    entries.map(async ({ connector, credential }) => ({
      key: credentialKey(connector, credential),
      reference: credential.reference,
      status: await connectorCredentialStatus(appCredentialServices.manager, credential.reference)
    }))
  )
  if (revision !== statusRevision) return
  credentialStatuses.value = new Map(statuses.map(({ key, status }) => [key, status]))
  appConnectorCredentialReadiness.update(
    statuses.map(({ reference, status }) => ({ reference, status }))
  )
  let revoked = false
  for (const connector of connectors.value) {
    if (requiredCredentialsConfigured(connector)) continue
    revoked =
      appConnectorAuthorization.revoke(connector.contract.pluginId, connector.connectorId) ||
      revoked
  }
  if (revoked) authorizationVersion.value += 1
}

function credentialStatus(
  connector: PluginConnectorControl,
  credential: PluginConnectorCredentialControl
): CredentialStatus {
  return credentialStatuses.value.get(credentialKey(connector, credential)) ?? 'missing'
}

function credentialStatusTone(status: CredentialStatus): 'success' | 'warning' | 'error' {
  if (status === 'configured') return 'success'
  if (status === 'missing') return 'warning'
  return 'error'
}

function requiredCredentialsConfigured(connector: PluginConnectorControl): boolean {
  return connector.credentials
    .filter((credential) => credential.required)
    .every((credential) => credentialStatus(connector, credential) === 'configured')
}

function authorizationHelpId(connector: PluginConnectorControl): string {
  return `connector-authorization-help-${connector.connectorId}`
}

async function saveCredential(
  event: Event,
  connector: PluginConnectorControl,
  credential: PluginConnectorCredentialControl
): Promise<void> {
  const form = event.currentTarget
  if (!(form instanceof HTMLFormElement)) return
  const input = form.elements.namedItem('connector-credential')
  if (!(input instanceof HTMLInputElement)) return
  const key = credentialKey(connector, credential)
  credentialErrors.value = setMapValue(credentialErrors.value, key)
  setBusy(key, true)
  appConnectorAuthorization.revoke(connector.contract.pluginId, connector.connectorId)
  authorizationVersion.value += 1
  try {
    await saveConnectorCredential(appCredentialServices.manager, credential.reference, input)
    credentialStatuses.value = setMapValue(credentialStatuses.value, key, 'configured')
    appConnectorCredentialReadiness.update([
      { reference: credential.reference, status: 'configured' }
    ])
  } catch {
    credentialErrors.value = setMapValue(
      credentialErrors.value,
      key,
      copy.value.credentialActionFailed
    )
  } finally {
    setBusy(key, false)
  }
}

async function clearCredential(
  connector: PluginConnectorControl,
  credential: PluginConnectorCredentialControl
): Promise<void> {
  const key = credentialKey(connector, credential)
  credentialErrors.value = setMapValue(credentialErrors.value, key)
  setBusy(key, true)
  appConnectorAuthorization.revoke(connector.contract.pluginId, connector.connectorId)
  authorizationVersion.value += 1
  try {
    await clearConnectorCredential(appCredentialServices.manager, credential.reference)
    credentialStatuses.value = setMapValue(credentialStatuses.value, key, 'missing')
    appConnectorCredentialReadiness.update([{ reference: credential.reference, status: 'missing' }])
  } catch {
    credentialErrors.value = setMapValue(
      credentialErrors.value,
      key,
      copy.value.credentialActionFailed
    )
  } finally {
    setBusy(key, false)
  }
}

function authorize(connector: PluginConnectorControl): void {
  authorizationErrors.value = setMapValue(authorizationErrors.value, connector.connectorId)
  if (!requiredCredentialsConfigured(connector)) {
    authorizationErrors.value = setMapValue(
      authorizationErrors.value,
      connector.connectorId,
      copy.value.configureRequiredCredentials
    )
    return
  }
  if (!plugin.enabled || plugin.blockedReason) {
    authorizationErrors.value = setMapValue(
      authorizationErrors.value,
      connector.connectorId,
      copy.value.pluginUnavailable
    )
    return
  }
  if (!appConnectorHostAdapters.resolve(connector.contract)) {
    authorizationErrors.value = setMapValue(
      authorizationErrors.value,
      connector.connectorId,
      copy.value.adapterUnavailable
    )
    return
  }
  try {
    appConnectorAuthorization.authorize(connector.contract, connector.packageDigest)
    authorizationVersion.value += 1
  } catch {
    authorizationErrors.value = setMapValue(
      authorizationErrors.value,
      connector.connectorId,
      copy.value.authorizationActionFailed
    )
  }
}

function revoke(connector: PluginConnectorControl): void {
  appConnectorAuthorization.revoke(connector.contract.pluginId, connector.connectorId)
  authorizationErrors.value = setMapValue(authorizationErrors.value, connector.connectorId)
  authorizationVersion.value += 1
}

watch(
  () => plugin,
  () => void refreshCredentialStatuses(),
  { immediate: true }
)
onBeforeUnmount(() => {
  statusRevision += 1
})
</script>

<template>
  <section v-if="connectors.length" class="mt-2 space-y-2" data-test-id="plugin-connector-controls">
    <div>
      <h5 class="text-[10px] font-semibold text-surface">{{ copy.title }}</h5>
      <p class="text-[9px] text-muted">{{ copy.description }}</p>
    </div>

    <article
      v-for="connector in connectors"
      :key="connector.connectorId"
      class="rounded border border-border/70 bg-panel p-2 text-[9px] text-muted"
      :data-test-id="`plugin-connector-${connector.connectorId}`"
    >
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p class="font-medium text-surface">{{ connector.name }}</p>
          <p class="break-all font-mono">{{ connector.connectorId }}</p>
          <p class="mt-0.5">{{ connector.description }}</p>
        </div>
        <AppBadge :tone="connector.authorized ? 'success' : 'neutral'">
          {{ connector.authorized ? copy.authorized : copy.notAuthorized }}
        </AppBadge>
      </div>

      <dl class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono">
        <template v-if="connector.origins.length">
          <dt>{{ copy.origin }}</dt>
          <dd class="break-all text-surface">{{ connector.origins.join(', ') }}</dd>
        </template>
        <template v-if="connector.originTemplates.length">
          <dt>{{ copy.originTemplate }}</dt>
          <dd class="break-all text-surface">{{ connector.originTemplates.join(', ') }}</dd>
        </template>
        <dt>{{ copy.method }}</dt>
        <dd class="break-all text-surface">{{ connector.methods.join(', ') }}</dd>
        <dt>adapterId</dt>
        <dd class="break-all text-surface">{{ connector.adapterId }}</dd>
      </dl>

      <aside
        v-if="connector.manualSetup"
        class="mt-1.5 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-1.5 py-1 text-[var(--color-warning-text)]"
      >
        <p class="font-medium">{{ copy.manualSetup }}</p>
        <p>{{ connector.manualSetup.note }}</p>
        <p v-if="connector.manualSetup.scopes.length" class="mt-0.5">
          {{ copy.requiredScopes }}:
          <span class="font-mono">{{ connector.manualSetup.scopes.join(', ') }}</span>
        </p>
      </aside>

      <div class="mt-1.5 space-y-1">
        <div
          v-for="operation in connector.operations"
          :key="operation.operationId"
          class="rounded border border-border/60 px-1.5 py-1"
        >
          <div class="flex items-center gap-1">
            <AppBadge :tone="operation.kind === 'mutation' ? 'warning' : 'neutral'">
              {{ connectorOperationKindLabel(operation.kind, copy) }}
            </AppBadge>
            <span class="text-surface">{{ operation.name }}</span>
            <span class="break-all font-mono">({{ operation.operationId }})</span>
          </div>
          <p class="mt-0.5">{{ operation.description }}</p>
          <dl v-if="operation.request" class="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 font-mono">
            <dt>{{ operation.request.originTemplate ? copy.originTemplate : copy.origin }}</dt>
            <dd class="break-all text-surface">
              {{ operation.request.origin ?? operation.request.originTemplate }}
            </dd>
            <dt>{{ copy.method }}</dt>
            <dd class="text-surface">{{ operation.request.method }}</dd>
            <dt>{{ copy.path }}</dt>
            <dd class="break-all text-surface">{{ operation.request.pathTemplate }}</dd>
          </dl>
          <p v-else class="mt-0.5 text-error">{{ copy.requestUnavailable }}</p>
          <PluginConnectorOperationRunner
            v-if="connector.authorized && operation.request"
            :connector="connector"
            :operation="operation"
            :copy="copy"
          />
        </div>
      </div>

      <p
        v-if="connector.hasMutation"
        class="mt-1.5 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-1.5 py-1 text-[var(--color-warning-text)]"
        role="alert"
      >
        {{ copy.mutationWarning }}
      </p>

      <div v-if="connector.credentials.length" class="mt-1.5 space-y-1.5">
        <form
          v-for="credential in connector.credentials"
          :key="credential.slotId"
          class="rounded border border-border/60 p-1.5"
          @submit.prevent="saveCredential($event, connector, credential)"
        >
          <div class="flex items-center gap-1">
            <label
              class="min-w-0 flex-1 font-medium text-surface"
              :for="`connector-credential-${connector.connectorId}-${credential.slotId}`"
            >
              {{ credential.label }}
              <span class="font-normal text-muted">
                · {{ credential.required ? copy.required : copy.optional }} · {{ credential.kind }}
              </span>
            </label>
            <AppBadge :tone="credentialStatusTone(credentialStatus(connector, credential))">
              {{ connectorCredentialStatusLabel(credentialStatus(connector, credential), copy) }}
            </AppBadge>
          </div>
          <p v-if="credential.description" class="mt-0.5 text-muted">
            {{ credential.description }}
          </p>
          <div class="mt-1 flex gap-1">
            <input
              :id="`connector-credential-${connector.connectorId}-${credential.slotId}`"
              name="connector-credential"
              type="password"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              :placeholder="copy.credentialPlaceholder"
              class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface outline-none focus:border-accent"
            />
            <button
              type="submit"
              class="rounded bg-accent px-2 py-1 font-medium text-white disabled:opacity-50"
              :disabled="busyCredentialKeys.has(credentialKey(connector, credential))"
            >
              {{ copy.save }}
            </button>
            <button
              type="button"
              class="rounded border border-border px-2 py-1 text-surface disabled:opacity-50"
              :disabled="busyCredentialKeys.has(credentialKey(connector, credential))"
              @click="clearCredential(connector, credential)"
            >
              {{ copy.clear }}
            </button>
          </div>
          <p
            v-if="credentialErrors.get(credentialKey(connector, credential))"
            class="mt-1 text-error"
            role="alert"
          >
            {{ credentialErrors.get(credentialKey(connector, credential)) }}
          </p>
        </form>
      </div>

      <div class="mt-1.5 flex items-center gap-1.5 border-t border-border/60 pt-1.5">
        <p class="min-w-0 flex-1">{{ copy.sessionAuthorization }}</p>
        <button
          v-if="!connector.authorized"
          type="button"
          class="rounded bg-accent px-2 py-1 font-medium text-white disabled:opacity-50"
          :disabled="!requiredCredentialsConfigured(connector)"
          :aria-describedby="
            requiredCredentialsConfigured(connector) ? undefined : authorizationHelpId(connector)
          "
          @click="authorize(connector)"
        >
          {{ copy.authorize }}
        </button>
        <button
          v-else
          type="button"
          class="rounded border border-border px-2 py-1 text-surface"
          @click="revoke(connector)"
        >
          {{ copy.revoke }}
        </button>
      </div>
      <p
        v-if="!connector.authorized && !requiredCredentialsConfigured(connector)"
        :id="authorizationHelpId(connector)"
        class="mt-1 text-warning"
        role="status"
      >
        {{ copy.configureRequiredCredentials }}
      </p>
      <p v-if="authorizationErrors.get(connector.connectorId)" class="mt-1 text-error" role="alert">
        {{ authorizationErrors.get(connector.connectorId) }}
      </p>
    </article>
  </section>
</template>
