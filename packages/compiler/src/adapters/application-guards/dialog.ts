/** One accessible asynchronous confirmation, retired by route/owner invalidation. */
export function applicationGuardDialogSource(): string {
  return `let dismissCurrentDialog: (() => void) | undefined
export function dismissLeaveConfirmation(): void { dismissCurrentDialog?.() }
export function confirmLeave(message: string, signal?: AbortSignal): Promise<boolean> {
  dismissCurrentDialog?.()
  if (typeof document === 'undefined' || signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const previous = document.activeElement
    const scroll = { x: window.scrollX, y: window.scrollY }
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', 'Leave this page?')
    dialog.setAttribute('data-openpencil-leave-confirmation', '')
    Object.assign(dialog.style, { maxWidth: 'min(420px,90vw)', padding: '24px', border: '1px solid #94a3b8', borderRadius: '12px', color: '#0f172a', background: '#fff' })
    const text = document.createElement('p')
    text.textContent = message
    const actions = document.createElement('div')
    Object.assign(actions.style, { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' })
    const stay = document.createElement('button'), leave = document.createElement('button')
    stay.type = leave.type = 'button'
    stay.textContent = 'Stay'; leave.textContent = 'Leave page'
    let settled = false
    const finish = (allowed: boolean) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', cancel)
      if (dismissCurrentDialog === cancel) dismissCurrentDialog = undefined
      dialog.remove()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
      window.scrollTo(scroll.x, scroll.y)
      resolve(allowed)
    }
    const cancel = () => finish(false)
    dismissCurrentDialog = cancel
    stay.onclick = cancel; leave.onclick = () => finish(true)
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); cancel() })
    dialog.addEventListener('close', cancel)
    signal?.addEventListener('abort', cancel, { once: true })
    actions.append(stay, leave); dialog.append(text, actions); document.body.append(dialog)
    if (typeof dialog.showModal !== 'function') { cancel(); return }
    try { dialog.showModal(); stay.focus({ preventScroll: true }); window.scrollTo(scroll.x, scroll.y) } catch { cancel() }
  })
}
`
}
