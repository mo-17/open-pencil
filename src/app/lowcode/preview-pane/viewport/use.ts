import { computed, ref, type CSSProperties } from 'vue'

export type PreviewViewport = 'fit' | 'phone' | 'landscape' | 'tablet' | 'desktop'

const dimensions = {
  phone: [390, 844],
  landscape: [844, 390],
  tablet: [768, 1024],
  desktop: [1440, 1000]
} as const

/** Change only the existing iframe's viewport; retain its route, session and unsaved form values. */
export function usePreviewViewport() {
  const viewport = ref<PreviewViewport>('fit')
  const frameStyle = computed<CSSProperties>(() => {
    if (viewport.value === 'fit') return { width: '100%', height: '100%' }
    const [width, height] = dimensions[viewport.value]
    return {
      width: `${width}px`,
      minWidth: `${width}px`,
      height: `${height}px`,
      marginInline: 'auto'
    }
  })
  return { viewport, frameStyle }
}
