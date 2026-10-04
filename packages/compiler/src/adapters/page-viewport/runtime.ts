export const PAGE_VIEWPORT_RUNTIME_FILE = 'src/lib/open-pencil-page-viewport.ts'

/** Self-contained DOM runtime shared by generated React and Vue projects, including preview VFS. */
export function pageViewportRuntimeSource(): string {
  return `export interface PageViewportConfig {
  version: 1
  mode: 'responsive' | 'fit-width' | 'fixed'
  designWidth: number
  designHeight: number
  originX: number
  originY: number
  backgroundColor?: string
}
export function pageViewportHostStyle(config: PageViewportConfig): Record<string,string | number> {
  return { width:'100%', minWidth:0, minHeight:'100dvh', position:'relative', backgroundColor:config.backgroundColor ?? 'transparent' }
}
export function pageViewportCanvasStyle(config: PageViewportConfig): Record<string,string | number> {
  return config.mode === 'fit-width'
    ? { position:'relative', width:config.designWidth+'px', height:config.designHeight+'px', minHeight:0, margin:0 }
    : { position:'relative', width:'100%', minWidth:0, minHeight:'100dvh', margin:0 }
}
export function pageViewportContentStyle(config: PageViewportConfig): Record<string,string | number> {
  // A zero-size absolute origin adds no phantom overflow box around the normalized children.
  return { position:'absolute', left:-config.originX+'px', top:-config.originY+'px', width:0, height:0 }
}
export function mountPageViewport(host: HTMLElement, canvas: HTMLElement, config: PageViewportConfig): () => void {
  if (config.mode !== 'fit-width' || !Number.isFinite(config.designWidth) || config.designWidth <= 0) return () => {}
  const win = host.ownerDocument.defaultView
  if (!win) return () => {}
  const oldZoom = canvas.style.getPropertyValue('zoom'), oldPriority = canvas.style.getPropertyPriority('zoom')
  let disposed = false, previousWidth = -1, pendingWidth = -1, frame: number | undefined
  const update = (width: number) => {
    if (disposed || !Number.isFinite(width) || width <= 0 || width === previousWidth) return
    previousWidth = width
    canvas.style.setProperty('zoom', String(width / config.designWidth))
  }
  // ResizeObserver delivery must only read/queue. Zoom can change the host's height;
  // applying it within delivery produces an undelivered-notifications loop error.
  const queueWidth = (width: number) => {
    if (disposed || !Number.isFinite(width) || width <= 0 || (frame === undefined && width === previousWidth)) return
    pendingWidth = width
    if (frame !== undefined) return
    frame = win.requestAnimationFrame(() => { frame = undefined; update(pendingWidth) })
  }
  const measureWidth = () => {
    const style = win.getComputedStyle(host)
    return host.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0)
  }
  const readWidth = () => queueWidth(measureWidth())
  update(measureWidth())
  const observer = typeof win.ResizeObserver === 'function'
    ? new win.ResizeObserver(entries => {
        for (const entry of entries) if (entry.target === host) queueWidth(entry.contentRect.width)
      })
    : undefined
  if (observer) observer.observe(host)
  else win.addEventListener('resize', readWidth)
  return () => {
    if (disposed) return
    disposed = true
    if (frame !== undefined) win.cancelAnimationFrame(frame)
    frame = undefined
    observer?.disconnect()
    win.removeEventListener('resize', readWidth)
    if (oldZoom) canvas.style.setProperty('zoom', oldZoom, oldPriority)
    else canvas.style.removeProperty('zoom')
  }
}
`
}
