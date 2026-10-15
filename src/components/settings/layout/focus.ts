import { nextTick } from 'vue'

/** Move focus only after validation has rendered its field feedback. */
export async function focusInvalidField(
  container: HTMLElement | null | undefined,
  isCurrent: () => boolean = () => true
) {
  await nextTick()
  if (!isCurrent()) return
  container?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}
