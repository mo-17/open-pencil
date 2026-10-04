/** Embedded only in the existing dev preview bridge; no generated runtime dependency. */
export function buildPreviewAdaptationRuntime(): string {
  return String.raw`
function createPreviewAdaptation(post: (payload: Record<string, unknown>) => void) {
  const MAX_ELEMENTS = 4096
  const MAX_ITEMS = 128
  const MAX_ANCESTORS = 64
  type Property = { value: string; priority: string; owned: string }
  type Saved = { font: Property; line: Property }
  const saved = new Map<HTMLElement, Saved>()
  let revision = -1
  let textScale = 1
  let diagnostics = false
  let disposed = false
  let listening = false
  let pending: number | null = null
  let mutation: MutationObserver | null = null
  let resize: ResizeObserver | null = null
  let measuredWidth = -1
  let measuredHeight = -1

  function active(): boolean { return !disposed && (textScale !== 1 || diagnostics) }
  function original(element: HTMLElement, name: string): Property {
    return { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name), owned: '' }
  }
  function restoreProperty(element: HTMLElement, name: string, property: Property): void {
    if (element.style.getPropertyValue(name) !== property.owned || element.style.getPropertyPriority(name) !== 'important') return
    if (property.value) element.style.setProperty(name, property.value, property.priority)
    else element.style.removeProperty(name)
  }
  function restore(): void {
    for (const [element, value] of saved) {
      restoreProperty(element, 'font-size', value.font)
      if (value.line.owned) restoreProperty(element, 'line-height', value.line)
    }
    saved.clear()
  }
  function connectMutation(): void {
    if (active() && document.body) mutation?.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  }
  function queue(): void {
    if (!active() || pending !== null) return
    pending = requestAnimationFrame(scan)
  }
  function stop(): void {
    if (pending !== null) cancelAnimationFrame(pending)
    pending = null
    mutation?.disconnect()
    resize?.disconnect()
    mutation = null
    resize = null
    if (listening) {
      window.removeEventListener('resize', queue)
      window.removeEventListener('popstate', queue)
      document.fonts?.removeEventListener('loadingdone', queue)
      listening = false
    }
    restore()
  }
  function start(): void {
    if (listening) return
    listening = true
    window.addEventListener('resize', queue)
    window.addEventListener('popstate', queue)
    document.fonts?.addEventListener('loadingdone', queue)
    void document.fonts?.ready.then(queue)
    if (typeof MutationObserver !== 'undefined') mutation = new MutationObserver(queue)
    connectMutation()
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      measuredWidth = -1
      measuredHeight = -1
      resize = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect
        if (!rect || (rect.width === measuredWidth && rect.height === measuredHeight)) return
        measuredWidth = rect.width
        measuredHeight = rect.height
        queue()
      })
      resize.observe(document.body)
    }
  }
  function validNodeId(value: string | null): value is string {
    if (!value || value.length > 512) return false
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (code <= 31 || (code >= 127 && code <= 159)) return false
    }
    return true
  }
  function textElement(element: HTMLElement): boolean {
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return true
    let child = element.firstChild
    for (let index = 0; child && index < 32; index++, child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) return true
    }
    return false
  }
  function authoredFixedHeight(element: HTMLElement): boolean {
    const inline = element.style.getPropertyValue('height').trim()
    if (inline) return /^\d+(?:\.\d+)?px$/.test(inline)
    const classes = Array.from(element.classList)
    if (classes.some((name) => /(?:^|:)h-(?:auto|fit|full|min|max)$/.test(name))) return false
    return classes.some((name) => /^h-(?:\d+(?:\.\d+)?|px|\[\d+(?:\.\d+)?px\])$/.test(name))
  }
  function inspectContext(element: HTMLElement): { ignored: boolean; limited: boolean } {
    let current: HTMLElement | null = element
    for (let depth = 0; current && depth < MAX_ANCESTORS; depth++, current = current.parentElement) {
      const style = getComputedStyle(current)
      if (current.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return { ignored: true, limited: false }
      if (current !== document.body && current !== document.documentElement) {
        const clamp = style.getPropertyValue('-webkit-line-clamp')
        if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.textOverflow === 'ellipsis' || (clamp && clamp !== 'none' && clamp !== '0')) return { ignored: true, limited: false }
      }
      if (current === document.body || current === document.documentElement) return { ignored: false, limited: false }
    }
    return { ignored: current !== null, limited: current !== null }
  }
  function scan(): void {
    pending = null
    if (!active() || !document.body) return
    mutation?.disconnect()
    let truncated = false
    const elements: HTMLElement[] = []
    try {
      // Restore all owned ancestors first. New descendants must never inherit a previously scaled base.
      restore()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      let current: Node | null = document.body
      let visited = 0
      while (current && visited < MAX_ELEMENTS) {
        visited++
        if (current instanceof HTMLElement && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(current.tagName)) elements.push(current)
        current = walker.nextNode()
      }
      truncated = current !== null
      // Read the entire bounded base snapshot before writing any font overrides.
      const bases = elements.map((element) => {
        const style = getComputedStyle(element)
        return { element, font: Number.parseFloat(style.fontSize), line: Number.parseFloat(style.lineHeight), saved: { font: original(element, 'font-size'), line: original(element, 'line-height') } }
      })
      if (textScale !== 1) {
        for (const base of bases) {
          if (!Number.isFinite(base.font) || base.font <= 0) continue
          base.saved.font.owned = String(base.font * textScale) + 'px'
          base.element.style.setProperty('font-size', base.saved.font.owned, 'important')
          base.saved.font.owned = base.element.style.getPropertyValue('font-size')
          base.saved.font.owned = base.element.style.getPropertyValue('font-size')
          if (Number.isFinite(base.line) && base.line > 0) {
            base.saved.line.owned = String(base.line * textScale) + 'px'
            base.element.style.setProperty('line-height', base.saved.line.owned, 'important')
            base.saved.line.owned = base.element.style.getPropertyValue('line-height')
            base.saved.line.owned = base.element.style.getPropertyValue('line-height')
          }
          saved.set(base.element, base.saved)
        }
      }
      if (diagnostics) {
        const items: { nodeId: string; kind: 'horizontal-overflow' | 'text-clipping' | 'fixed-height-risk' }[] = []
        const seen = new Set<string>()
        const add = (nodeId: string, kind: 'horizontal-overflow' | 'text-clipping' | 'fixed-height-risk') => {
          const key = nodeId + ':' + kind
          if (seen.has(key)) return
          seen.add(key)
          if (items.length >= MAX_ITEMS) { truncated = true; return }
          items.push({ nodeId, kind })
        }
        for (const element of elements) {
          const nodeId = element.getAttribute('data-node-id')
          if (!validNodeId(nodeId)) continue
          const context = inspectContext(element)
          truncated ||= context.limited
          if (context.ignored) continue
          const rect = element.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          if (rect.left < -1 || rect.right > window.innerWidth + 1) add(nodeId, 'horizontal-overflow')
          const style = getComputedStyle(element)
          const clippedY = (style.overflowY === 'hidden' || style.overflowY === 'clip') && element.scrollHeight > element.clientHeight + 1
          const clippedX = (style.overflowX === 'hidden' || style.overflowX === 'clip') && element.scrollWidth > element.clientWidth + 1
          if (textElement(element) && (clippedX || clippedY)) add(nodeId, 'text-clipping')
          if (textScale > 1 && textElement(element) && authoredFixedHeight(element)) {
            const font = Number.parseFloat(style.fontSize)
            const line = Number.parseFloat(style.lineHeight)
            const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
            const needed = (Number.isFinite(line) ? line : font * 1.2) + padding
            if (Number.isFinite(needed) && needed > element.clientHeight + 1) add(nodeId, 'fixed-height-risk')
          }
        }
        post({ type: 'adaptation', revision, items, truncated })
      }
    } finally {
      connectMutation()
    }
  }
  function update(value: { revision: number; textScale: number; diagnostics: boolean }): void {
    if (disposed || value.revision < revision) return
    if (value.revision === revision && (value.textScale !== textScale || value.diagnostics !== diagnostics)) return
    revision = value.revision
    textScale = value.textScale
    diagnostics = value.diagnostics
    if (!active()) {
      stop()
      post({ type: 'adaptation', revision, items: [], truncated: false })
      return
    }
    start()
    queue()
  }
  function dispose(): void { disposed = true; stop() }
  return { update, dispose }
}
`
}
