/** Shared by native and enhanced generated numeric inputs in both web targets. */
export function numberDraftRuntimeSource(): string {
  return String.raw`/** A number state stores committed finite numbers; the DOM owns incomplete text. */
export function parseNumericDraft(
  raw: string,
  input?: HTMLInputElement,
  event?: Event
): number | undefined {
  if (raw === '' || raw.trim() !== raw || input?.validity.badInput) return undefined
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return undefined
  if (raw.endsWith('.') || /[eE][+-]?$/.test(raw)) return undefined
  // Native number inputs may expose "1" while the user is still typing "1.".
  // The InputEvent data identifies that intermediate edit without rewriting it.
  if (event && 'data' in event && typeof event.data === 'string' && event.data.endsWith('.') && !raw.endsWith('.')) return undefined
  const number = Number(raw)
  return Number.isFinite(number) ? number : undefined
}

/** The generated page language also controls the browser-facing draft error. */
export function incompleteNumberMessage(input: HTMLInputElement): string {
  const language = input.closest('[lang]')?.getAttribute('lang') ?? input.ownerDocument.documentElement.lang
  return language?.toLowerCase().startsWith('zh')
    ? '请输入完整的数字。'
    : 'Please enter a complete number.'
}
`
}
