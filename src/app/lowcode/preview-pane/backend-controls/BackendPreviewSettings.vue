<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'
import { computed, onScopeDispose, ref, watch } from 'vue'
import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import {
  MANAGED_BACKEND_PRESET_IDS,
  MANAGED_BACKEND_PREVIEW_ORIGIN,
  buildManagedKeycloakClientConfiguration,
  resolveManagedBackendPreset,
  type ManagedBackendPresetDraft,
  type ManagedBackendPresetId,
  type ManagedBackendPresetIssue,
  type ManagedBackendPresetMissing
} from '../managed-backend/presets'
import { LOCAL_BACKEND_PREVIEW_CALLBACK } from '../local-backend-connection'
import {
  LOCAL_KEYCLOAK_ISSUER,
  LOCAL_KEYCLOAK_JWKS,
  isHTTPSKeycloakIssuer
} from '../managed-backend/presets/identity'
import BackendPreviewCopyValue from './BackendPreviewCopyValue.vue'
import { backendPreviewCopy } from './copy'

const { authentication, busy } = defineProps<{
  authentication: BackendHttpAPIOIDCAuthenticationIRV1 | null
  busy: boolean
}>()
const draft = defineModel<ManagedBackendPresetDraft>('draft', { required: true })
const { locale } = useI18n()
const text = computed(() => backendPreviewCopy(locale.value))
function initialPreset(): ManagedBackendPresetId {
  if (authentication?.issuer === LOCAL_KEYCLOAK_ISSUER) return 'local-keycloak'
  if (authentication && isHTTPSKeycloakIssuer(authentication.issuer)) return 'https-keycloak'
  return 'oidc'
}
const presetId = ref(initialPreset())
const applied = ref(false)
const choosingCA = ref(false)
const caError = ref(false)
let disposed = false
onScopeDispose(() => {
  disposed = true
})
watch(
  draft,
  () => {
    applied.value = false
  },
  { deep: true, flush: 'sync' }
)
const advancedOpen = ref(Boolean(draft.value.caFile))
const caRequired = computed(() => draft.value.jwksURL.trim() === LOCAL_KEYCLOAK_JWKS)
watch(
  caRequired,
  (required) => {
    if (required) advancedOpen.value = true
  },
  { immediate: true }
)
const preset = computed(() =>
  resolveManagedBackendPreset({ presetId: presetId.value, authentication, draft: draft.value })
)
const presetLabels = computed(() => ({
  'local-keycloak': text.value.localPreset,
  'https-keycloak': text.value.httpsPreset,
  oidc: text.value.oidcPreset
}))
const presetHint = computed(
  () =>
    ({
      'local-keycloak': text.value.localPresetHint,
      'https-keycloak': text.value.httpsPresetHint,
      oidc: text.value.oidcPresetHint
    })[presetId.value]
)
const issueLabels = computed<Record<ManagedBackendPresetIssue, string>>(() => ({
  'document-authentication-required': text.value.presetDocumentRequired,
  'local-keycloak-issuer-required': text.value.presetLocalRequired,
  'https-keycloak-issuer-required': text.value.presetHTTPSRequired,
  'invalid-jwks-url': text.value.presetJWKSInvalid,
  'invalid-ca-path': text.value.presetCAInvalid,
  'invalid-audience': text.value.presetAudienceInvalid
}))
const missingLabels = computed<Record<ManagedBackendPresetMissing, string>>(() => ({
  authentication: text.value.authenticationRequired,
  audience: text.value.audience,
  jwksURL: text.value.jwks,
  caFile: text.value.ca
}))
const clientJSON = computed(() => {
  if (presetId.value === 'oidc') return null
  const configuration = buildManagedKeycloakClientConfiguration(authentication, draft.value)
  return configuration ? JSON.stringify(configuration, null, 2) : null
})

function applyPreset() {
  if (busy || !preset.value.applicable) return
  Object.assign(draft.value, preset.value.patch)
  applied.value = true
  if (preset.value.missing.includes('caFile')) advancedOpen.value = true
}

async function chooseCA() {
  const requestDraft = draft.value
  const requestIssuer = authentication?.issuer
  const requestClientId = authentication?.clientId
  const isCurrent = () =>
    !disposed &&
    !busy &&
    draft.value === requestDraft &&
    authentication?.issuer === requestIssuer &&
    authentication?.clientId === requestClientId
  choosingCA.value = true
  caError.value = false
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      title: text.value.chooseCATitle,
      multiple: false,
      directory: false,
      filters: [{ name: 'Public CA certificate', extensions: ['pem', 'crt'] }]
    })
    if (isCurrent() && typeof selected === 'string') draft.value.caFile = selected
  } catch {
    if (isCurrent()) caError.value = true
  } finally {
    choosingCA.value = false
  }
}
</script>

<template>
  <div class="space-y-5 pt-3 text-xs">
    <section class="rounded-lg border border-border bg-input/40 p-3">
      <h3 class="font-medium text-surface">{{ text.presets }}</h3>
      <p class="mt-1.5 leading-relaxed text-muted">{{ text.presetHint }}</p>
      <label class="mt-3 block text-surface">
        {{ text.presetLabel }}
        <select
          v-model="presetId"
          :disabled="busy"
          class="mt-1.5 h-9 w-full rounded border border-border bg-input px-2 focus-visible:ring-2 focus-visible:ring-accent"
          @change="applied = false"
        >
          <option v-for="id in MANAGED_BACKEND_PRESET_IDS" :key="id" :value="id">
            {{ presetLabels[id] }}
          </option>
        </select>
      </label>
      <p class="mt-2 leading-relaxed text-muted">{{ presetHint }}</p>
      <p v-if="presetId === 'oidc'" class="mt-1 leading-relaxed text-muted">
        {{ text.oidcRequirements }}
      </p>
      <ul v-if="preset.issues.length" class="mt-2 space-y-1 text-amber-500">
        <li v-for="issue in preset.issues" :key="issue">{{ issueLabels[issue] }}</li>
      </ul>
      <button
        type="button"
        :disabled="busy || !preset.applicable"
        class="mt-3 min-h-9 rounded border border-border px-3 text-surface hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        @click="applyPreset"
      >
        {{ text.applyPreset }}
      </button>
      <p v-if="applied" role="status" class="mt-2 leading-relaxed text-muted">
        {{ preset.ready ? text.presetReady : text.presetApplied }}
        <span v-if="preset.missing.length" class="block"
          >{{ text.missingFields }}:
          {{ preset.missing.map((item) => missingLabels[item]).join(' · ') }}</span
        >
      </p>
    </section>
    <dl v-if="authentication" class="space-y-3 rounded-lg border border-border p-3">
      <div>
        <dt class="text-muted">{{ text.issuer }}</dt>
        <dd class="mt-1 select-text break-all text-surface">{{ authentication.issuer }}</dd>
      </div>
      <div>
        <dt class="text-muted">{{ text.clientId }}</dt>
        <dd class="mt-1 select-text break-all text-surface">{{ authentication.clientId }}</dd>
      </div>
    </dl>
    <p v-else class="leading-relaxed text-muted">{{ text.authenticationRequired }}</p>
    <label class="block text-surface">
      {{ text.audience }}
      <input
        v-model="draft.audience"
        :disabled="busy"
        data-test-id="managed-backend-audience"
        type="text"
        autocomplete="off"
        class="mt-1.5 h-9 w-full rounded border border-border bg-input px-3 focus-visible:ring-2 focus-visible:ring-accent"
      />
    </label>
    <label class="block text-surface">
      {{ text.jwks }}
      <input
        v-model="draft.jwksURL"
        :disabled="busy"
        data-test-id="managed-backend-jwks"
        type="url"
        autocomplete="off"
        class="mt-1.5 h-9 w-full rounded border border-border bg-input px-3 focus-visible:ring-2 focus-visible:ring-accent"
      />
    </label>
    <details
      :open="advancedOpen"
      @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary
        class="cursor-pointer rounded py-2 font-medium text-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        {{ text.advanced }}
      </summary>
      <div class="mt-2">
        <label class="block text-surface">
          {{ caRequired ? text.caRequired : text.ca }}
          <input
            v-model="draft.caFile"
            :disabled="busy || choosingCA"
            data-test-id="managed-backend-ca"
            type="text"
            autocomplete="off"
            placeholder="/path/to/trusted-ca.pem"
            class="mt-1.5 h-9 w-full rounded border border-border bg-input px-3 focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <div class="mt-2 flex items-start gap-3">
          <p class="flex-1 leading-relaxed text-muted">{{ text.caHint }}</p>
          <button
            type="button"
            :disabled="busy || choosingCA"
            class="min-h-9 shrink-0 rounded border border-border px-3 text-surface hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            @click="chooseCA"
          >
            {{ text.chooseCA }}
          </button>
        </div>
        <p v-if="caError" role="status" class="mt-2 text-amber-500">{{ text.chooseCAFailed }}</p>
      </div>
    </details>
    <div class="space-y-3 border-t border-border pt-3">
      <BackendPreviewCopyValue
        :label="text.callback"
        :value="`${MANAGED_BACKEND_PREVIEW_ORIGIN}${LOCAL_BACKEND_PREVIEW_CALLBACK}`"
      />
      <BackendPreviewCopyValue :label="text.origin" :value="MANAGED_BACKEND_PREVIEW_ORIGIN" />
      <p class="leading-relaxed text-muted">{{ text.browserHint }}</p>
    </div>
    <details v-if="clientJSON">
      <summary
        class="cursor-pointer rounded py-2 font-medium text-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        {{ text.identityClient }}
      </summary>
      <p class="mt-1 leading-relaxed text-muted">{{ text.identityClientHint }}</p>
      <BackendPreviewCopyValue
        class="mt-2"
        :label="text.clientJSON"
        :value="clientJSON"
        multiline
      />
    </details>
  </div>
</template>
