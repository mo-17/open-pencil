import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

import type {
  PreviewEditorPayload,
  PreviewInboundMessage,
  PreviewAdaptationDiagnosticItem,
  PreviewTextScale
} from '../iframe/messages'

interface AdaptationSessionOptions {
  enabled: Readonly<Ref<boolean>>
  textScale: Readonly<Ref<PreviewTextScale>>
  /** Null while unavailable; change when frame, document or page changes. */
  context: Readonly<Ref<string | null>>
  viewport: Readonly<Ref<string>>
  post: (payload: PreviewEditorPayload) => void
}

/** Correlate each measurement with the current preview settings and frame. */
export function usePreviewAdaptation(options: AdaptationSessionOptions) {
  const revision = ref(0)
  const waiting = ref(false)
  const items = ref<PreviewAdaptationDiagnosticItem[]>([])
  const truncated = ref(false)
  let disposed = false
  let issuedSettings = ''
  let issuedContext: string | null = null
  const settingsKey = () =>
    JSON.stringify([
      options.enabled.value,
      options.textScale.value,
      options.context.value,
      options.viewport.value
    ])

  function request(): void {
    if (disposed) return
    revision.value += 1
    issuedSettings = settingsKey()
    items.value = []
    truncated.value = false
    waiting.value = options.context.value !== null && options.enabled.value
    if (options.context.value === null) {
      if (issuedContext !== null) {
        options.post({
          type: 'adaptation',
          revision: revision.value,
          textScale: 1,
          diagnostics: false
        })
      }
      issuedContext = null
      return
    }
    issuedContext = options.context.value
    options.post({
      type: 'adaptation',
      revision: revision.value,
      textScale: options.textScale.value,
      diagnostics: options.enabled.value
    })
  }

  const stop = watch(
    [options.enabled, options.textScale, options.context, options.viewport],
    request,
    { immediate: true, flush: 'post' }
  )

  function accept(data: Extract<PreviewInboundMessage, { type: 'adaptation' }>): boolean {
    if (
      disposed ||
      settingsKey() !== issuedSettings ||
      options.context.value === null ||
      !options.enabled.value ||
      data.revision !== revision.value
    )
      return false
    items.value = data.items
    truncated.value = data.truncated
    waiting.value = false
    return true
  }

  onScopeDispose(() => {
    stop()
    disposed = true
    if (options.context.value !== null) {
      options.post({
        type: 'adaptation',
        revision: revision.value + 1,
        textScale: 1,
        diagnostics: false
      })
    }
  })

  return { items, waiting, truncated, accept, request, revision: computed(() => revision.value) }
}
