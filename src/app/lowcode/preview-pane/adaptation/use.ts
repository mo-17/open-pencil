import type { useCodeMessages } from '@open-pencil/vue'

import type {
  PreviewAdaptationDiagnosticItem,
  PreviewAdaptationDiagnosticKind
} from '../iframe/messages'

export interface AdaptationDiagnosticViewItem extends PreviewAdaptationDiagnosticItem {
  nodeName: string
}

type CodeMessages = ReturnType<typeof useCodeMessages>['value']
export type AdaptationDiagnosticMessages = {
  [
    Key in keyof Pick<
      CodeMessages,
      | 'previewAdaptationDiagnosticsDisabled'
      | 'previewAdaptationDiagnosticsWaiting'
      | 'previewAdaptationDiagnosticsEmpty'
      | 'previewAdaptationDiagnosticsTruncated'
      | 'previewAdaptationHorizontalOverflow'
      | 'previewAdaptationTextClipping'
      | 'previewAdaptationFixedHeightRisk'
    >
  ]: string
}

export function adaptationDiagnosticMessage(
  messages: AdaptationDiagnosticMessages,
  kind: PreviewAdaptationDiagnosticKind
): string {
  if (kind === 'horizontal-overflow') return messages.previewAdaptationHorizontalOverflow
  if (kind === 'text-clipping') return messages.previewAdaptationTextClipping
  return messages.previewAdaptationFixedHeightRisk
}

export function adaptationDiagnosticStatus(
  messages: AdaptationDiagnosticMessages,
  state: { enabled: boolean; waiting: boolean; truncated: boolean; itemCount: number }
): string {
  if (!state.enabled) return messages.previewAdaptationDiagnosticsDisabled
  if (state.waiting) return messages.previewAdaptationDiagnosticsWaiting
  if (state.truncated) return messages.previewAdaptationDiagnosticsTruncated
  return state.itemCount === 0 ? messages.previewAdaptationDiagnosticsEmpty : ''
}
