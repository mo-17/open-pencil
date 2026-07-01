const HIGHLIGHT_CLASSES = ['ring-1', 'ring-accent', 'bg-accent/10']

export function flashLowcodeFocusHighlight(target: HTMLElement | null | undefined): void {
  if (!target) return
  target.dataset.lowcodeFocusHighlighted = 'true'
  target.classList.add(...HIGHLIGHT_CLASSES)
  window.setTimeout(() => {
    target.classList.remove(...HIGHLIGHT_CLASSES)
    Reflect.deleteProperty(target.dataset, 'lowcodeFocusHighlighted')
  }, 1200)
}
