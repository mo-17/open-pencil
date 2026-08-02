import { useFilter } from 'reka-ui'
import { computed, ref, watch } from 'vue'

import type {
  FontFamilyLicenseDisplay,
  FontFamilyOption,
  FontLicenseDisplayStatus
} from '@open-pencil/core/text'

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

  const { contains } = useFilter({ sensitivity: 'base' })
  const filtered = computed(() => {
    return families.value.filter(
      (option) =>
        matchesFontLicenseFilter(option, licenseFilter.value) &&
        (!searchTerm.value || contains(option.family, searchTerm.value))
    )
  })

  async function loadFamilies() {
    if (families.value.length > 0 || loading.value) return
    loading.value = true
    try {
      families.value = normalizeOptions(await options.listFamilies())
      accessState.value = options.localFontAccess?.state() ?? accessState.value
    } finally {
      loading.value = false
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
    try {
      families.value = normalizeOptions(await options.localFontAccess.load())
      accessState.value = options.localFontAccess.state()
    } finally {
      loading.value = false
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
