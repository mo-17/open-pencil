import { computed, ref, type CSSProperties } from 'vue'

import type { PreviewTextScale } from '../iframe/messages'
import { boundPreviewDimension, PREVIEW_VIEWPORT_DIMENSIONS } from './dimensions'

export type PreviewViewport = 'fit' | 'phone' | 'landscape' | 'tablet' | 'desktop' | 'custom'

export const PREVIEW_TEXT_SCALES = [1, 1.3, 1.6, 2] as const satisfies readonly PreviewTextScale[]

/** Change only the existing iframe's viewport; retain its route, session and unsaved form values. */
export function usePreviewViewport() {
  const selectedViewport = ref<PreviewViewport>('fit')
  const pixelsWidth = ref(390)
  const pixelsHeight = ref(844)
  const selectedTextScale = ref<PreviewTextScale>(1)
  const keyboard = ref(false)
  const diagnostics = ref(false)
  const viewport = computed({
    get: () => selectedViewport.value,
    set(value: PreviewViewport) {
      if (typeof value !== 'string') return
      if (value !== 'fit' && value !== 'custom') {
        if (!Object.hasOwn(PREVIEW_VIEWPORT_DIMENSIONS, value)) return
        const [width, height] = PREVIEW_VIEWPORT_DIMENSIONS[value]
        pixelsWidth.value = width
        pixelsHeight.value = height
      }
      selectedViewport.value = value
    }
  })
  function editDimension(value: number, target: typeof pixelsWidth) {
    const bounded = boundPreviewDimension(value)
    if (bounded === null) return
    target.value = bounded
    selectedViewport.value = 'custom'
  }
  const width = computed({
    get: () => pixelsWidth.value,
    set: (value: number) => editDimension(value, pixelsWidth)
  })
  const height = computed({
    get: () => pixelsHeight.value,
    set: (value: number) => editDimension(value, pixelsHeight)
  })
  const textScale = computed({
    get: () => selectedTextScale.value,
    set(value: PreviewTextScale) {
      if (PREVIEW_TEXT_SCALES.some((scale) => scale === value)) selectedTextScale.value = value
    }
  })
  const frameStyle = computed<CSSProperties>(() => {
    if (viewport.value === 'fit') return { width: '100%', height: '100%' }
    return {
      width: `${width.value}px`,
      minWidth: `${width.value}px`,
      height: `${height.value}px`,
      marginInline: 'auto'
    }
  })
  return { viewport, width, height, textScale, keyboard, diagnostics, frameStyle }
}
