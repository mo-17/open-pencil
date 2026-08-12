<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  FontPickerRoot,
  useI18n,
  type FontFamilyLicenseDisplay,
  type FontFamilyOption,
  type FontPickerUI,
  type FontLicenseDisplayStatus,
  type FontLicenseFilter
} from '@open-pencil/vue'

import AppBadge from '@/components/ui/AppBadge.vue'
import { useSelectUI } from '@/components/ui/select'
import { usePopoverUI } from '@/components/ui/popover'
import Tip from '@/components/ui/Tip.vue'
import {
  listFamilies,
  importedFontRevision,
  inspectFontFamilyLicense,
  loadFont,
  localFontAccessState,
  requestLocalFontAccess
} from '@/app/editor/fonts'

import { WEB_FONT_PROVIDER_IDS } from '@open-pencil/core/text'

const { panels } = useI18n()
const { label: providedLabel } = defineProps<{ label?: string }>()
const label = computed(() => providedLabel ?? panels.value.fontFamily)
const modelValue = defineModel<string>({ required: true })
const emit = defineEmits<{ select: [family: string] }>()

const cls = usePopoverUI({
  content: 'w-[var(--reka-combobox-trigger-width)] min-w-64 overflow-hidden p-0'
})
const selectCls = useSelectUI({
  trigger: 'w-full rounded px-2 py-1 text-xs',
  item: 'w-full gap-2 px-3 py-2.5 text-sm leading-tight'
})

const ui = computed<FontPickerUI>(() => ({
  trigger: selectCls.trigger,
  content: cls.content,
  item: selectCls.item,
  search:
    'w-full border-b border-border bg-transparent px-3 py-2 text-sm text-surface outline-none placeholder:text-muted',
  filters: 'border-b border-border bg-panel-secondary px-3 py-1.5',
  empty: 'px-2 py-3 text-center text-xs text-muted',
  emptyAction: 'mt-2 rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50'
}))

const previewFontLoads = new Set<string>()
const startedLicenseInspections = new Set<string>()
const checkingLicenses = reactive(new Set<string>())

const localFontAccess = {
  state: localFontAccessState,
  load: requestLocalFontAccess
}

function loadPreviewFont(family: string, source: string) {
  if (!WEB_FONT_PROVIDER_IDS.includes(source as (typeof WEB_FONT_PROVIDER_IDS)[number])) return
  if (previewFontLoads.has(family)) return
  previewFontLoads.add(family)
  void loadFont(family)
}

function optionKey(option: FontFamilyOption): string {
  return `${option.source}|${option.family}`
}

function prepareFontOption(option: FontFamilyOption): void {
  loadPreviewFont(option.family, option.source)
  if (option.source !== 'local' || option.licenseDisplay?.status !== 'unknown') return

  const key = optionKey(option)
  if (startedLicenseInspections.has(key)) return
  startedLicenseInspections.add(key)
  checkingLicenses.add(key)
  void runFontLicenseInspection(option, key)
}

async function runFontLicenseInspection(option: FontFamilyOption, key: string): Promise<void> {
  try {
    option.licenseDisplay = await inspectFontFamilyLicense(option)
  } finally {
    checkingLicenses.delete(key)
    startedLicenseInspections.delete(key)
  }
}

function isLicenseChecking(option: FontFamilyOption): boolean {
  return checkingLicenses.has(optionKey(option))
}

function licenseLabel(status: FontLicenseDisplayStatus): string {
  if (status === 'free') return panels.value.fontLicenseFree
  if (status === 'declared_open') return panels.value.fontLicenseDeclaredOpen
  if (status === 'requires_license') return panels.value.fontLicenseRequiresLicense
  return panels.value.fontLicenseUnknown
}

function licenseDescription(
  display: FontFamilyLicenseDisplay | undefined,
  checking = false
): string {
  if (checking) return panels.value.fontLicenseCheckingDescription
  if (display?.status === 'free') {
    return display.evidence === 'provider_policy'
      ? panels.value.fontLicenseProviderPolicyDescription
      : panels.value.fontLicenseFreeDescription
  }
  if (display?.status === 'declared_open') {
    return panels.value.fontLicenseDeclaredOpenDescription
  }
  if (display?.status === 'requires_license') {
    return panels.value.fontLicenseRequiresLicenseDescription
  }
  return panels.value.fontLicenseUnknownDescription
}

function licenseTone(status: FontLicenseDisplayStatus): 'success' | 'warning' | 'error' {
  if (status === 'free') return 'success'
  if (status === 'requires_license') return 'error'
  return 'warning'
}

function updateLicenseFilter(setLicenseFilter: (filter: FontLicenseFilter) => void, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const filter = target.value
  if (
    filter === 'all' ||
    filter === 'free' ||
    filter === 'declared_open' ||
    filter === 'requires_license' ||
    filter === 'unknown'
  ) {
    setLicenseFilter(filter)
  }
}
</script>

<template>
  <FontPickerRoot
    :key="importedFontRevision"
    v-model="modelValue"
    data-test-id="font-picker-root"
    :list-families="listFamilies"
    :local-font-access="localFontAccess"
    :ui="ui"
    :empty-license-filter-text="panels.noFontsForLicenseFilter"
    :search-placeholder="panels.searchFonts"
    :empty-search-text="panels.noFontsFound"
    :empty-fonts-text="panels.noLocalFontsAvailable"
    :empty-fonts-hint="panels.localFontsAccessHint"
    @select="emit('select', $event)"
  >
    <template #trigger="{ option }">
      <button
        type="button"
        data-test-id="font-picker-trigger"
        :aria-label="label"
        :class="selectCls.trigger"
      >
        <span class="truncate">{{ modelValue }}</span>
        <Tip
          v-if="option"
          :label="licenseDescription(option.licenseDisplay, isLicenseChecking(option))"
        >
          <AppBadge
            data-test-id="font-license-trigger-badge"
            :data-license-status="option.licenseDisplay?.status ?? 'unknown'"
            :tone="licenseTone(option.licenseDisplay?.status ?? 'unknown')"
          >
            {{
              isLicenseChecking(option)
                ? panels.fontLicenseChecking
                : licenseLabel(option.licenseDisplay?.status ?? 'unknown')
            }}
          </AppBadge>
        </Tip>
        <icon-lucide-chevron-down class="size-3 shrink-0 text-muted" />
      </button>
    </template>

    <template #filters="{ licenseFilter, setLicenseFilter }">
      <label :class="ui.filters">
        <span class="sr-only">{{ panels.fontLicenseFilter }}</span>
        <select
          data-test-id="font-license-filter"
          class="h-6 w-full rounded border border-border bg-input px-2 text-[10px] text-surface outline-none focus-visible:border-accent"
          :aria-label="panels.fontLicenseFilter"
          :value="licenseFilter"
          @keydown.up.stop
          @keydown.down.stop
          @keydown.enter.stop
          @keydown.space.stop
          @change="updateLicenseFilter(setLicenseFilter, $event)"
        >
          <option value="all">{{ panels.fontLicenseAll }}</option>
          <option value="free">{{ panels.fontLicenseFree }}</option>
          <option value="declared_open">{{ panels.fontLicenseDeclaredOpen }}</option>
          <option value="requires_license">{{ panels.fontLicenseRequiresLicense }}</option>
          <option value="unknown">{{ panels.fontLicenseUnknown }}</option>
        </select>
      </label>
    </template>

    <template #item="{ option, family, selected, source, licenseDisplay, licenseStatus }">
      <div
        :key="`${source}\u0000${family}`"
        data-test-id="font-picker-item"
        :data-license-status="licenseStatus"
        :data-license-checking="isLicenseChecking(option)"
        class="flex min-w-0 flex-1 items-center gap-2"
        @vue:mounted="prepareFontOption(option)"
      >
        <icon-lucide-check v-if="selected" class="size-3 shrink-0 text-accent" />
        <span v-else class="size-3 shrink-0" />
        <span class="truncate" :style="{ fontFamily: `'${family}', sans-serif` }">{{
          family
        }}</span>
        <span class="font-sans ml-auto flex shrink-0 items-center gap-1">
          <Tip :label="licenseDescription(licenseDisplay, isLicenseChecking(option))">
            <AppBadge
              data-test-id="font-license-badge"
              :data-license-status="licenseStatus"
              :tone="licenseTone(licenseStatus)"
              :aria-label="licenseDescription(licenseDisplay, isLicenseChecking(option))"
            >
              <icon-lucide-loader-circle
                v-if="isLicenseChecking(option)"
                class="size-2.5 animate-spin"
                aria-hidden="true"
              />
              <icon-lucide-circle-check
                v-else-if="licenseStatus === 'free'"
                class="size-2.5"
                aria-hidden="true"
              />
              <icon-lucide-file-check
                v-else-if="licenseStatus === 'declared_open'"
                class="size-2.5"
                aria-hidden="true"
              />
              <icon-lucide-lock-keyhole
                v-else-if="licenseStatus === 'requires_license'"
                class="size-2.5"
                aria-hidden="true"
              />
              <icon-lucide-circle-help v-else class="size-2.5" aria-hidden="true" />
              {{
                isLicenseChecking(option) ? panels.fontLicenseChecking : licenseLabel(licenseStatus)
              }}
            </AppBadge>
          </Tip>
          <Tip :label="source">
            <span class="shrink-0 rounded bg-input px-1.5 py-0.5 text-[9px] uppercase text-muted">
              {{ source }}
            </span>
          </Tip>
        </span>
      </div>
    </template>
  </FontPickerRoot>
</template>
