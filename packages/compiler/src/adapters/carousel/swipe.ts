/** Generated DOM gesture controller shared by both web runtimes. */
export const CAROUSEL_SWIPE_RUNTIME = `function installCarouselSwipe(
  host: HTMLElement,
  navigate: (direction: -1 | 1) => void,
  setInteracting: (active: boolean) => void
): () => void {
  const document = host.ownerDocument
  const view = document.defaultView
  let gesture: { id: number; x: number; y: number; dragging: boolean } | null = null
  let suppressClickUntil = 0
  const owns = (target: EventTarget | null): target is Element =>
    target instanceof Element && target.closest('[data-openpencil-carousel]') === host
  const selectedText = () => {
    const selection = document.getSelection()
    return selection && !selection.isCollapsed && selection.anchorNode && host.contains(selection.anchorNode)
  }
  const finish = (timeStamp = 0) => {
    const current = gesture
    if (!current) return
    gesture = null
    if (current.dragging) suppressClickUntil = timeStamp + 500
    if (host.hasPointerCapture(current.id)) host.releasePointerCapture(current.id)
    setInteracting(false)
  }
  const down = (event: PointerEvent) => {
    if (!owns(event.target)) return
    suppressClickUntil = 0
    if (event.defaultPrevented || !event.isPrimary || event.button !== 0 || gesture || selectedText()) return
    if (event.target.closest('button,a,input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="slider"],[data-openpencil-carousel-dots],[data-openpencil-carousel-arrows]')) return
    // Desktop text dragging keeps native selection instead of changing slides.
    if (event.pointerType !== 'touch' && event.target.closest('[data-openpencil-carousel-text]')) return
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false }
    setInteracting(true)
  }
  const additionalPointer = (event: PointerEvent) => {
    if (gesture && event.pointerId !== gesture.id) finish(event.timeStamp)
  }
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    if ((event.pointerType === 'mouse' && event.buttons === 0) || selectedText()) {
      finish(event.timeStamp)
      return
    }
    const x = Math.abs(event.clientX - gesture.x)
    const y = Math.abs(event.clientY - gesture.y)
    if (!gesture.dragging) {
      if (y > 10 && y > x) {
        finish(event.timeStamp)
        return
      }
      if (x < 18 || x <= y * 1.25) return
      gesture.dragging = true
      host.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
  }
  const up = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const x = event.clientX - gesture.x
    const y = event.clientY - gesture.y
    const advance = gesture.dragging && Math.abs(x) >= 40 && Math.abs(x) > Math.abs(y) * 1.25
    finish(event.timeStamp)
    if (advance) navigate(x < 0 ? 1 : -1)
  }
  const cancel = (event: Event) => {
    if (event instanceof PointerEvent && gesture && event.pointerId !== gesture.id) return
    finish(event.timeStamp)
  }
  const lostCapture = (event: PointerEvent) => {
    if (event.target === host && gesture?.dragging && !host.hasPointerCapture(event.pointerId)) cancel(event)
  }
  const select = (event: Event) => {
    if (!gesture) return
    const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null
    if (target?.closest('[data-openpencil-carousel-text]')) finish(event.timeStamp)
    else event.preventDefault()
  }
  const visibility = () => { if (document.hidden) finish() }
  const click = (event: MouseEvent) => {
    if (!owns(event.target) || event.detail === 0 || event.timeStamp > suppressClickUntil) return
    suppressClickUntil = 0
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const drag = (event: DragEvent) => { if (gesture) event.preventDefault() }
  host.addEventListener('pointerdown', down)
  host.addEventListener('lostpointercapture', lostCapture)
  host.addEventListener('click', click, true)
  host.addEventListener('dragstart', drag)
  host.addEventListener('selectstart', select)
  document.addEventListener('pointerdown', additionalPointer, true)
  document.addEventListener('pointermove', move, { passive: false })
  document.addEventListener('pointerup', up)
  document.addEventListener('pointercancel', cancel)
  document.addEventListener('visibilitychange', visibility)
  view?.addEventListener('blur', cancel)
  return () => {
    finish()
    host.removeEventListener('pointerdown', down)
    host.removeEventListener('lostpointercapture', lostCapture)
    host.removeEventListener('click', click, true)
    host.removeEventListener('dragstart', drag)
    host.removeEventListener('selectstart', select)
    document.removeEventListener('pointerdown', additionalPointer, true)
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
    document.removeEventListener('pointercancel', cancel)
    document.removeEventListener('visibilitychange', visibility)
    view?.removeEventListener('blur', cancel)
  }
}
`
