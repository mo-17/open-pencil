import { useLocalStorage } from '@vueuse/core'
import { computed, watch } from 'vue'

export const PREVIEW_TOOLBAR_LAYOUT_STORAGE_KEY = 'open-pencil:preview-toolbar-layout'

export const PREVIEW_TOOLBAR_LAYOUTS = ['adaptive', 'compact', 'classic'] as const

export type PreviewToolbarLayout = (typeof PREVIEW_TOOLBAR_LAYOUTS)[number]

// Preserve the pre-existing toolbar until a user explicitly chooses one of the
// new layouts. This preference only changes presentation; compiler inputs stay
// owned by PreviewPane.
export const DEFAULT_PREVIEW_TOOLBAR_LAYOUT: PreviewToolbarLayout = 'classic'

export function normalizePreviewToolbarLayout(value: unknown): PreviewToolbarLayout {
  return typeof value === 'string' &&
    PREVIEW_TOOLBAR_LAYOUTS.includes(value as PreviewToolbarLayout)
    ? (value as PreviewToolbarLayout)
    : DEFAULT_PREVIEW_TOOLBAR_LAYOUT
}

export function repairStoredPreviewToolbarLayout(
  value: unknown,
  persist: (layout: PreviewToolbarLayout) => void
): PreviewToolbarLayout {
  const layout = normalizePreviewToolbarLayout(value)
  if (value !== layout) persist(layout)
  return layout
}

const storedLayout = useLocalStorage<unknown>(
  PREVIEW_TOOLBAR_LAYOUT_STORAGE_KEY,
  DEFAULT_PREVIEW_TOOLBAR_LAYOUT
)

watch(
  storedLayout,
  (value) => {
    repairStoredPreviewToolbarLayout(value, (layout) => {
      storedLayout.value = layout
    })
  },
  { immediate: true }
)

export const previewToolbarLayout = computed<PreviewToolbarLayout>({
  get: () => normalizePreviewToolbarLayout(storedLayout.value),
  set: (layout) => {
    storedLayout.value = normalizePreviewToolbarLayout(layout)
  }
})
