import { tryOnScopeDispose, watchImmediate } from '@vueuse/core'
import { sortBy } from 'es-toolkit'
import { useFilter } from 'reka-ui'
import { computed, ref, watch } from 'vue'

import type {
  FontFamilyLicenseDisplay,
  FontFamilyOption,
  FontLicenseDisplayStatus
} from '@open-pencil/core/text'

import { useRetainedActivity } from '#vue/lifecycle/retention/context'

export type FontAccessState = 'unsupported' | 'prompt' | 'granted' | 'denied'
export type {
  FontFamilyLicenseDisplay,
  FontFamilyOption,
  FontFamilySource,
  FontLicenseDisplayStatus
} from '@open-pencil/core/text'

export type FontLicenseFilter = 'all' | FontLicenseDisplayStatus

export interface FontAccessController {
  state: () => FontAccessState
  load: () => Promise<string[] | FontFamilyOption[]>
}

/**
 * Options for {@link useFontPicker}.
 */
export interface UseFontPickerOptions {
  /** Writable model for the selected font family. */
  modelValue: { value: string }
  /** Async source for available font families. */
  listFamilies: () => Promise<string[] | FontFamilyOption[]>
  /** Host-provided local-font permission controller. */
  localFontAccess?: FontAccessController
  /** Optional callback fired after a family is selected. */
  onSelect?: (family: string) => void
}

function unknownLicenseDisplay(): FontFamilyLicenseDisplay {
  return {
    status: 'unknown',
    scope: 'catalog_source',
    evidence: 'insufficient'
  }
}

function normalizeOptions(items: string[] | FontFamilyOption[]): FontFamilyOption[] {
  return items.map((item) => {
    if (typeof item === 'string') {
      return { family: item, source: 'local', licenseDisplay: unknownLicenseDisplay() }
    }
    return { ...item, licenseDisplay: item.licenseDisplay ?? unknownLicenseDisplay() }
  })
}

export function fontFamilyOptionLicenseStatus(option: FontFamilyOption): FontLicenseDisplayStatus {
  return option.licenseDisplay?.status ?? 'unknown'
}

export function matchesFontLicenseFilter(
  option: FontFamilyOption,
  filter: FontLicenseFilter
): boolean {
  return filter === 'all' || fontFamilyOptionLicenseStatus(option) === filter
}

/**
 * Returns searchable font-picker state and selection helpers.
 */
export function useFontPicker(options: UseFontPickerOptions) {
  const families = ref<FontFamilyOption[]>([])
  const searchTerm = ref('')
  const licenseFilter = ref<FontLicenseFilter>('all')
  const open = ref(false)
  const loading = ref(false)
  const accessState = ref<FontAccessState>(options.localFontAccess?.state() ?? 'granted')
  const active = useRetainedActivity()
  let requestVersion = 0

  function cancelLoad() {
    requestVersion++
    loading.value = false
  }

  watchImmediate(
    () => active?.value ?? true,
    (enabled) => {
      if (!enabled) cancelLoad()
    },
    { flush: 'sync' }
  )
  tryOnScopeDispose(cancelLoad)

  const { contains, startsWith } = useFilter({ sensitivity: 'base' })
  /** 0 for the family the search names, 1 for one it begins, 2 for any other match. */
  function rank(family: string, term: string): number {
    if (!startsWith(family, term)) return 2
    return family.length === term.length ? 0 : 1
  }
  // Figma lists the family a search names first: "Lora" gives Lora, then Explora.
  const filtered = computed(() => {
    const term = searchTerm.value.trim()
    const licensed = families.value.filter((option) =>
      matchesFontLicenseFilter(option, licenseFilter.value)
    )
    if (!term) return licensed
    const matches = licensed.filter((option) => contains(option.family, term))
    return sortBy(matches, [(option) => rank(option.family, term)])
  })

  async function loadFamilies() {
    if (families.value.length > 0 || loading.value) return
    loading.value = true
    const version = ++requestVersion
    try {
      const items = await options.listFamilies()
      if (version !== requestVersion) return
      families.value = normalizeOptions(items)
      accessState.value = options.localFontAccess?.state() ?? accessState.value
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  watch(open, async (isOpen) => {
    if (!isOpen) return
    searchTerm.value = ''
    accessState.value = options.localFontAccess?.state() ?? accessState.value
    if (accessState.value === 'prompt') {
      await requestAccess()
      return
    }
    await loadFamilies()
  })

  async function requestAccess() {
    if (!options.localFontAccess || loading.value) return
    loading.value = true
    const version = ++requestVersion
    try {
      const items = await options.localFontAccess.load()
      if (version !== requestVersion) return
      families.value = normalizeOptions(items)
      accessState.value = options.localFontAccess.state()
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  function select(family: string) {
    options.modelValue.value = family
    options.onSelect?.(family)
    open.value = false
  }

  function setLicenseFilter(filter: FontLicenseFilter) {
    licenseFilter.value = filter
  }

  return {
    families,
    searchTerm,
    licenseFilter,
    open,
    filtered,
    loading,
    accessState,
    requestAccess,
    setLicenseFilter,
    select
  }
}
