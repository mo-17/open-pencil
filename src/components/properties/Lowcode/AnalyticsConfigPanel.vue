<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type {
  AnalyticsConfig,
  AnalyticsConsentRegionPreset,
  AnalyticsProvider
} from '@open-pencil/scene-graph'
import { useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { analyticsProviderHelp } from '@/app/lowcode/analytics-help'

const PROVIDERS: AnalyticsProvider[] = ['ga4', 'plausible', 'posthog']
type ConsentRegionPresetDraft = AnalyticsConsentRegionPreset | ''
const GA4_ID_RE = /^G-[A-Z0-9]+$/i
const PLAUSIBLE_DOMAIN_RE = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const POSTHOG_KEY_RE = /^phc_[A-Za-z0-9_]+$/
const DEFAULT_ANALYTICS_DRAFT = {
  enabled: true,
  provider: 'ga4' as AnalyticsProvider,
  id: '',
  endpoint: '',
  pageViews: true,
  respectDoNotTrack: false,
  consentRegionPreset: '' as ConsentRegionPresetDraft,
  consentRequired: false,
  consentAnalyticsDefault: true,
  bannerText: '',
  analyticsDescription: '',
  policyUrl: '',
  policyLabel: ''
}

const editor = useEditorStore()
const sectionCls = useSectionUI()

const config = useSceneComputed<AnalyticsConfig | undefined>(() => {
  const root = editor.graph.getNode(editor.graph.rootId)
  return root?.lowcodeAnalyticsConfig
})

const enabledDraft = ref(config.value?.enabled ?? true)
const providerDraft = ref<AnalyticsProvider>(config.value?.provider ?? 'ga4')
const idDraft = ref(config.value?.id ?? '')
const endpointDraft = ref(config.value?.endpoint ?? '')
const pageViewsDraft = ref(config.value?.pageViews ?? true)
const respectDoNotTrackDraft = ref(config.value?.respectDoNotTrack ?? false)
const consentRegionPresetDraft = ref<ConsentRegionPresetDraft>(
  config.value?.consentRegionPreset ?? ''
)
const consentRequiredDraft = ref(effectiveConsentRequired(config.value))
const consentAnalyticsDefaultDraft = ref(effectiveConsentAnalyticsDefault(config.value))
const consentBannerTextDraft = ref(config.value?.consentCopy?.bannerText ?? '')
const consentAnalyticsDescriptionDraft = ref(config.value?.consentCopy?.analyticsDescription ?? '')
const consentPolicyUrlDraft = ref(config.value?.consentCopy?.privacyPolicyUrl ?? '')
const consentPolicyLabelDraft = ref(config.value?.consentCopy?.privacyPolicyLabel ?? '')

const idPlaceholder = computed(() => {
  if (providerDraft.value === 'ga4') return 'G-XXXXXXXXXX'
  if (providerDraft.value === 'plausible') return 'example.com'
  return 'phc_...'
})

const endpointPlaceholder = computed(() => {
  if (providerDraft.value === 'plausible') return 'https://plausible.io/js/script.js'
  if (providerDraft.value === 'posthog') return 'https://app.posthog.com'
  return 'Not used by GA4'
})

const endpointEnabled = computed(() => providerDraft.value !== 'ga4')
const providerHelp = computed(() => analyticsProviderHelp(providerDraft.value))

const idError = computed(() => {
  const id = idDraft.value.trim()
  if (!id) return ''
  if (providerDraft.value === 'ga4' && !GA4_ID_RE.test(id)) return 'GA4 id should look like G-...'
  if (providerDraft.value === 'plausible' && !PLAUSIBLE_DOMAIN_RE.test(id)) {
    return 'Plausible id should be a domain such as example.com'
  }
  if (providerDraft.value === 'posthog' && !POSTHOG_KEY_RE.test(id)) {
    return 'PostHog project API keys usually start with phc_'
  }
  return ''
})

const endpointError = computed(() => {
  const endpoint = endpointDraft.value.trim()
  if (!endpoint || !endpointEnabled.value) return ''
  try {
    const url = new URL(endpoint)
    return url.protocol === 'http:' || url.protocol === 'https:' ? '' : 'Endpoint must be http(s)'
  } catch {
    return 'Endpoint must be a valid URL'
  }
})

const consentPolicyUrlError = computed(() => {
  const url = consentPolicyUrlDraft.value.trim()
  if (!url) return ''
  return isSafePolicyUrl(url) ? '' : 'Policy URL must be http(s) or start with /'
})

watch(
  () => config.value,
  (next) => {
    const draft = draftFromAnalyticsConfig(next)
    enabledDraft.value = draft.enabled
    providerDraft.value = draft.provider
    idDraft.value = draft.id
    endpointDraft.value = draft.endpoint
    pageViewsDraft.value = draft.pageViews
    respectDoNotTrackDraft.value = draft.respectDoNotTrack
    consentRegionPresetDraft.value = draft.consentRegionPreset
    consentRequiredDraft.value = draft.consentRequired
    consentAnalyticsDefaultDraft.value = draft.consentAnalyticsDefault
    consentBannerTextDraft.value = draft.bannerText
    consentAnalyticsDescriptionDraft.value = draft.analyticsDescription
    consentPolicyUrlDraft.value = draft.policyUrl
    consentPolicyLabelDraft.value = draft.policyLabel
  }
)

function commit(next: AnalyticsConfig | undefined): void {
  editor.updateNodeWithUndo(
    editor.graph.rootId,
    { lowcodeAnalyticsConfig: next },
    'Update analytics config'
  )
}

function commitDraft(): void {
  const id = idDraft.value.trim()
  const endpoint = endpointEnabled.value ? endpointDraft.value.trim() : ''
  if (!id) {
    commit(undefined)
    return
  }
  if (idError.value || endpointError.value || consentPolicyUrlError.value) return
  const consentCopy = buildConsentCopy()
  const preset = consentRegionPresetDraft.value || undefined
  const presetRequiresConsent = preset === 'eea'
  const presetAnalyticsDefault = preset !== 'eea'
  commit({
    provider: providerDraft.value,
    id,
    ...(enabledDraft.value === false ? { enabled: false } : {}),
    ...(pageViewsDraft.value === false ? { pageViews: false } : {}),
    ...(respectDoNotTrackDraft.value === true ? { respectDoNotTrack: true } : {}),
    ...(preset ? { consentRegionPreset: preset } : {}),
    ...(consentRequiredDraft.value !== presetRequiresConsent
      ? { consentRequired: consentRequiredDraft.value }
      : {}),
    ...(consentRequiredDraft.value === true &&
    consentAnalyticsDefaultDraft.value !== presetAnalyticsDefault
      ? { consentAnalyticsDefault: consentAnalyticsDefaultDraft.value }
      : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(consentCopy ? { consentCopy } : {})
  })
}

function updateEnabled(value: boolean): void {
  enabledDraft.value = value
  commitDraft()
}

function updateProvider(value: AnalyticsProvider): void {
  providerDraft.value = value
  if (!endpointEnabled.value) endpointDraft.value = ''
  commitDraft()
}

function updatePageViews(value: boolean): void {
  pageViewsDraft.value = value
  commitDraft()
}

function updateRespectDoNotTrack(value: boolean): void {
  respectDoNotTrackDraft.value = value
  commitDraft()
}

function updateConsentRequired(value: boolean): void {
  consentRequiredDraft.value = value
  commitDraft()
}

function updateConsentRegionPreset(value: ConsentRegionPresetDraft): void {
  consentRegionPresetDraft.value = value
  if (value === 'eea') {
    consentRequiredDraft.value = true
    consentAnalyticsDefaultDraft.value = false
  }
  commitDraft()
}

function updateConsentCopy(): void {
  commitDraft()
}

function updateConsentAnalyticsDefault(value: boolean): void {
  consentAnalyticsDefaultDraft.value = value
  commitDraft()
}

function clearConfig(): void {
  enabledDraft.value = true
  providerDraft.value = 'ga4'
  idDraft.value = ''
  endpointDraft.value = ''
  pageViewsDraft.value = true
  respectDoNotTrackDraft.value = false
  consentRegionPresetDraft.value = ''
  consentRequiredDraft.value = false
  consentAnalyticsDefaultDraft.value = true
  consentBannerTextDraft.value = ''
  consentAnalyticsDescriptionDraft.value = ''
  consentPolicyUrlDraft.value = ''
  consentPolicyLabelDraft.value = ''
  commit(undefined)
}

function buildConsentCopy(): AnalyticsConfig['consentCopy'] | undefined {
  if (!consentRequiredDraft.value) return undefined
  const bannerText = consentBannerTextDraft.value.trim()
  const analyticsDescription = consentAnalyticsDescriptionDraft.value.trim()
  const privacyPolicyUrl = consentPolicyUrlDraft.value.trim()
  const privacyPolicyLabel = consentPolicyLabelDraft.value.trim()
  const copy: NonNullable<AnalyticsConfig['consentCopy']> = {
    ...(bannerText ? { bannerText } : {}),
    ...(analyticsDescription ? { analyticsDescription } : {}),
    ...(privacyPolicyUrl ? { privacyPolicyUrl } : {}),
    ...(privacyPolicyLabel ? { privacyPolicyLabel } : {})
  }
  return Object.keys(copy).length > 0 ? copy : undefined
}

function isSafePolicyUrl(value: string): boolean {
  if (value.startsWith('/')) return !value.startsWith('//')
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function draftFromAnalyticsConfig(
  config: AnalyticsConfig | undefined
): typeof DEFAULT_ANALYTICS_DRAFT {
  if (!config) return { ...DEFAULT_ANALYTICS_DRAFT }
  const copy = config.consentCopy ?? {}
  return {
    ...DEFAULT_ANALYTICS_DRAFT,
    enabled: config.enabled ?? true,
    provider: config.provider,
    id: config.id,
    endpoint: config.endpoint ?? '',
    pageViews: config.pageViews ?? true,
    respectDoNotTrack: config.respectDoNotTrack ?? false,
    consentRegionPreset: config.consentRegionPreset ?? '',
    consentRequired: effectiveConsentRequired(config),
    consentAnalyticsDefault: effectiveConsentAnalyticsDefault(config),
    bannerText: copy.bannerText ?? '',
    analyticsDescription: copy.analyticsDescription ?? '',
    policyUrl: copy.privacyPolicyUrl ?? '',
    policyLabel: copy.privacyPolicyLabel ?? ''
  }
}

function effectiveConsentRequired(config: AnalyticsConfig | undefined): boolean {
  if (config?.consentRequired !== undefined) return config.consentRequired
  return config?.consentRegionPreset === 'eea'
}

function effectiveConsentAnalyticsDefault(config: AnalyticsConfig | undefined): boolean {
  if (config?.consentAnalyticsDefault !== undefined) return config.consentAnalyticsDefault
  if (config?.consentRegionPreset === 'eea') return false
  return true
}
</script>

<template>
  <div data-test-id="lowcode-analytics-config-section" :class="sectionCls.wrapper">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">Analytics</label>
      <button
        v-if="config"
        type="button"
        data-test-id="lowcode-analytics-clear"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="clearConfig"
      >
        Clear
      </button>
    </div>

    <div class="flex flex-col gap-1.5">
      <label class="flex items-center gap-1 pl-1 text-[11px] text-muted">
        <input
          type="checkbox"
          :checked="enabledDraft"
          data-test-id="lowcode-analytics-enabled"
          @change="updateEnabled(($event.target as HTMLInputElement).checked)"
        />
        Enabled
      </label>
      <label class="flex items-center gap-1 pl-1 text-[11px] text-muted">
        <input
          type="checkbox"
          :checked="pageViewsDraft"
          data-test-id="lowcode-analytics-page-views"
          @change="updatePageViews(($event.target as HTMLInputElement).checked)"
        />
        Track page views
      </label>
      <label class="flex items-center gap-1 pl-1 text-[11px] text-muted">
        <input
          type="checkbox"
          :checked="respectDoNotTrackDraft"
          data-test-id="lowcode-analytics-respect-dnt"
          @change="updateRespectDoNotTrack(($event.target as HTMLInputElement).checked)"
        />
        Respect Do Not Track
      </label>
      <label class="grid gap-1 text-[11px] text-muted">
        <span class="pl-1">Consent preset</span>
        <select
          :value="consentRegionPresetDraft"
          aria-label="Analytics consent preset"
          data-test-id="lowcode-analytics-consent-preset"
          class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="
            updateConsentRegionPreset(
              ($event.target as HTMLSelectElement).value as ConsentRegionPresetDraft
            )
          "
        >
          <option value="">Manual</option>
          <option value="eea">EEA-style opt-in starter</option>
        </select>
      </label>
      <label class="flex items-center gap-1 pl-1 text-[11px] text-muted">
        <input
          type="checkbox"
          :checked="consentRequiredDraft"
          data-test-id="lowcode-analytics-consent-required"
          @change="updateConsentRequired(($event.target as HTMLInputElement).checked)"
        />
        Require consent before tracking
      </label>
      <div
        v-if="consentRequiredDraft"
        data-test-id="lowcode-analytics-consent-copy"
        class="grid gap-1.5 rounded border border-border bg-panel px-2 py-2"
      >
        <label class="text-[10px] uppercase tracking-normal text-muted">Consent copy</label>
        <label class="flex items-center gap-1 pl-1 text-[11px] text-muted">
          <input
            type="checkbox"
            :checked="consentAnalyticsDefaultDraft"
            data-test-id="lowcode-analytics-consent-default"
            @change="updateConsentAnalyticsDefault(($event.target as HTMLInputElement).checked)"
          />
          Analytics checked by default
        </label>
        <textarea
          v-model="consentBannerTextDraft"
          aria-label="Analytics consent banner text"
          data-test-id="lowcode-analytics-consent-banner-text"
          spellcheck="false"
          placeholder="This app uses analytics to understand usage. You can choose which optional tracking is allowed."
          class="min-h-16 w-full resize-y rounded border border-border bg-input px-2 py-1 text-[11px] text-surface outline-none focus:border-accent"
          @change="updateConsentCopy"
        />
        <input
          v-model="consentAnalyticsDescriptionDraft"
          aria-label="Analytics consent category description"
          data-test-id="lowcode-analytics-consent-description"
          spellcheck="false"
          placeholder="Helps the team understand page views and explicit tracked events."
          class="min-w-0 rounded border border-border bg-input px-2 py-1 text-[11px] text-surface outline-none focus:border-accent"
          @change="updateConsentCopy"
        />
        <div class="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-1">
          <input
            v-model="consentPolicyUrlDraft"
            aria-label="Analytics consent policy URL"
            :aria-invalid="consentPolicyUrlError ? 'true' : undefined"
            data-test-id="lowcode-analytics-consent-policy-url"
            spellcheck="false"
            placeholder="/privacy"
            :class="[
              'min-w-0 rounded border bg-input px-2 py-1 text-[11px] text-surface outline-none focus:border-accent',
              consentPolicyUrlError ? 'border-red-500' : 'border-border'
            ]"
            @change="updateConsentCopy"
          />
          <input
            v-model="consentPolicyLabelDraft"
            aria-label="Analytics consent policy label"
            data-test-id="lowcode-analytics-consent-policy-label"
            spellcheck="false"
            placeholder="Privacy policy"
            class="min-w-0 rounded border border-border bg-input px-2 py-1 text-[11px] text-surface outline-none focus:border-accent"
            @change="updateConsentCopy"
          />
        </div>
      </div>
      <select
        :value="providerDraft"
        aria-label="Analytics provider"
        data-test-id="lowcode-analytics-provider"
        class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="updateProvider(($event.target as HTMLSelectElement).value as AnalyticsProvider)"
      >
        <option v-for="provider in PROVIDERS" :key="provider" :value="provider">
          {{ provider }}
        </option>
      </select>
      <p
        data-test-id="lowcode-analytics-provider-help"
        class="rounded border border-border bg-panel px-2 py-1 text-[10px] text-muted"
      >
        <span class="font-medium text-surface">{{ providerHelp.idLabel }}:</span>
        {{ providerHelp.idHint }}
        <a
          :href="providerHelp.docsHref"
          target="_blank"
          rel="noreferrer"
          data-test-id="lowcode-analytics-provider-docs"
          class="ml-1 text-accent hover:underline"
        >
          Docs
        </a>
      </p>
      <input
        v-model="idDraft"
        aria-label="Analytics id"
        :aria-invalid="idError ? 'true' : undefined"
        data-test-id="lowcode-analytics-id"
        spellcheck="false"
        :placeholder="idPlaceholder"
        :class="[
          'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent',
          idError ? 'border-red-500' : 'border-border'
        ]"
        @change="commitDraft"
      />
      <p data-test-id="lowcode-analytics-endpoint-help" class="px-1 text-[10px] text-muted">
        {{ providerHelp.endpointHint }}
      </p>
      <input
        v-model="endpointDraft"
        aria-label="Analytics endpoint"
        :aria-invalid="endpointError ? 'true' : undefined"
        data-test-id="lowcode-analytics-endpoint"
        :disabled="!endpointEnabled"
        spellcheck="false"
        :placeholder="endpointPlaceholder"
        :class="[
          'min-w-0 rounded border bg-input px-2 py-1 font-mono text-xs text-surface outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50',
          endpointError ? 'border-red-500' : 'border-border'
        ]"
        @change="commitDraft"
      />
    </div>

    <p
      v-if="idError"
      data-test-id="lowcode-analytics-id-error"
      class="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
    >
      {{ idError }}
    </p>
    <p
      v-if="endpointError"
      data-test-id="lowcode-analytics-endpoint-error"
      class="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
    >
      {{ endpointError }}
    </p>
    <p
      v-if="consentPolicyUrlError"
      data-test-id="lowcode-analytics-consent-policy-url-error"
      class="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-500"
    >
      {{ consentPolicyUrlError }}
    </p>

    <p data-test-id="lowcode-analytics-note" class="mt-1.5 text-[10px] text-muted">
      Stores public GA4, Plausible, or PostHog client ids only. Do not paste provider admin tokens
      here.
    </p>
    <p data-test-id="lowcode-analytics-privacy-note" class="mt-1 text-[10px] text-muted">
      Consent mode exports __opGrantAnalyticsConsent() and __opRevokeAnalyticsConsent() for your
      generated app flows.
    </p>
    <p
      v-if="!idDraft.trim()"
      data-test-id="lowcode-analytics-id-note"
      class="mt-1 text-[10px] text-muted"
    >
      Add an id to persist this analytics config.
    </p>
  </div>
</template>
