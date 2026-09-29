import type { ToastAction } from '@open-pencil/scene-graph'

/** A transient confirmation; actionable errors and receipts remain in the page. */
export function templateToast(
  message: string,
  variant: ToastAction['variant'] = 'success'
): ToastAction {
  return {
    id: crypto.randomUUID(),
    kind: 'toast',
    messageExpr: JSON.stringify(message),
    variant,
    position: 'top-center',
    durationMs: 4000
  }
}
