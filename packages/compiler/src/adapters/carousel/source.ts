/** Shared generated contracts and presentation; framework lifecycle stays in its adapter. */
export const CAROUSEL_TYPES = `export interface OpenPencilCarouselSlide {
  title: string
  description: string
  imageUrl: string
  alt: string
  href: string
}
export interface OpenPencilCarouselConfig {
  label: string
  slides: readonly OpenPencilCarouselSlide[]
  initialIndex: number
  transition: 'slide' | 'fade'
  autoplay: boolean
  intervalMs: number
  loop: boolean
  showArrows: boolean
  showDots: boolean
  pauseOnHover: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  layout?: 'split' | 'overlay'
  imageFit?: 'cover' | 'contain' | 'fill'
  textPosition?: 'top' | 'center' | 'bottom'
  textAlign?: 'left' | 'center' | 'right'
  overlayOpacity?: number
  paginationStyle?: 'dots' | 'numbers' | 'fraction'
  arrowPosition?: 'sides' | 'top-corners' | 'bottom-corners' | 'bottom-left' | 'bottom-right'
  swipeEnabled?: boolean
}
`

export const CAROUSEL_INDEX_RUNTIME = `function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(0, index), Math.max(0, length - 1))
}
function carouselIndex(index: number, length: number, loop: boolean): number {
  return loop && length > 0 ? ((index % length) + length) % length : clampIndex(index, length)
}
function observeCarouselPagination(container: HTMLElement | null): () => void {
  if (!container) return () => {}
  const reveal = () => {
    const selected = container.querySelector('[aria-current=true]')
    if (!(selected instanceof HTMLElement)) return
    const host = container.getBoundingClientRect()
    const item = selected.getBoundingClientRect()
    if (item.left < host.left) container.scrollLeft -= host.left - item.left
    else if (item.right > host.right) container.scrollLeft += item.right - host.right
  }
  reveal()
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reveal)
  observer?.observe(container)
  return () => observer?.disconnect()
}
`

const HOST = '[data-openpencil-carousel]'
const SLIDE = '>[data-openpencil-carousel-track]>[data-openpencil-carousel-slide]'
const MEDIA = `${SLIDE}>[data-openpencil-carousel-media]`
const COPY = `${SLIDE}>[data-openpencil-carousel-copy]`
const TEXT = `${COPY}>[data-openpencil-carousel-text]`
const ARROWS = '>[data-openpencil-carousel-arrows]'
const PAGINATION = '>[data-openpencil-carousel-dots]'
const LOAD = `${MEDIA}>[data-openpencil-carousel-load-media]`
const AUTOPLAY = '>[data-openpencil-carousel-autoplay]'
const BUTTONS = `:where(${HOST}${ARROWS}>button,${HOST}${PAGINATION}>button,${HOST}${LOAD},${HOST}${AUTOPLAY})`

export const CAROUSEL_STYLES = `${HOST}{box-sizing:border-box;font-family:system-ui,sans-serif;min-width:0;min-height:0}
${HOST}${SLIDE}{display:flex;flex-direction:column}
${HOST}[data-swipe]>[data-openpencil-carousel-track],${HOST}[data-swipe]${COPY}{touch-action:pan-y pinch-zoom}
${HOST}${MEDIA}{flex-shrink:0;height:58%;position:relative}
${HOST}${COPY}{box-sizing:border-box;flex:1;min-height:0;padding:20px 20px 44px;overflow:auto}
${HOST}${TEXT}{flex-shrink:0;min-width:0;overflow-wrap:anywhere;width:100%}
${HOST}[data-autoplay]${SLIDE}:not([data-media])>[data-openpencil-carousel-copy]{padding-top:44px}
${HOST}[data-layout=overlay]${MEDIA}{height:100%;inset:0;position:absolute}
${HOST}[data-layout=overlay]${SLIDE}::before{background:#000;content:'';inset:0;opacity:var(--openpencil-carousel-overlay-opacity);pointer-events:none;position:absolute;z-index:1}
${HOST}[data-layout=overlay]${COPY}{display:flex;flex-direction:column;position:relative;z-index:2}
${HOST}[data-layout=overlay][data-text-position=center]${TEXT}{margin-block:auto}
${HOST}[data-layout=overlay][data-text-position=bottom]${TEXT}{margin-top:auto}
${HOST}[data-layout=overlay][data-autoplay]${COPY}{padding-top:44px}
${HOST}[data-layout=overlay]${SLIDE}[data-needs-media]>[data-openpencil-carousel-copy]{padding-top:60px}
${HOST}${TEXT}>h2{font-size:24px;font-weight:600;line-height:1.25;margin:0 0 8px}
${HOST}${TEXT}>p{font-size:14px;font-weight:400;line-height:1.5;margin:0;white-space:pre-wrap}
${HOST}${MEDIA}>img{display:block}
${BUTTONS}{font:inherit;cursor:pointer}
${BUTTONS}:disabled{cursor:default;opacity:.35}
:is(${HOST},${HOST}${COPY},${HOST}${TEXT}>h2>a,${BUTTONS}):focus-visible{outline:2px solid var(--openpencil-carousel-accent);outline-offset:2px}
${HOST}${ARROWS}{position:absolute;inset:auto 12px 2px;display:flex;height:32px;justify-content:space-between;pointer-events:none;z-index:2}
${HOST}[data-arrow-position=sides]${ARROWS}{bottom:auto;top:max(12px,min(calc(50% - 16px),calc(100% - 70px)))}
${HOST}[data-arrow-position=top-corners]${ARROWS}{bottom:auto;top:12px}
${HOST}[data-arrow-position=bottom-left]${ARROWS}{gap:8px;right:auto;width:72px}
${HOST}[data-arrow-position=bottom-right]${ARROWS}{gap:8px;left:auto;width:72px}
${HOST}[data-arrows][data-arrow-position=sides]${COPY}{padding-left:52px;padding-right:52px}
${HOST}[data-arrows][data-arrow-position=top-corners]${COPY}{padding-top:52px}
${HOST}[data-arrows][data-arrow-position=top-corners]${AUTOPLAY}{right:52px;top:12px}
${HOST}[data-arrows][data-arrow-position=top-corners][data-layout=overlay]${LOAD}{max-width:calc(100% - 16px);top:52px}
${HOST}[data-arrows][data-arrow-position=top-corners][data-layout=overlay]${SLIDE}[data-needs-media]>[data-openpencil-carousel-copy]{padding-top:96px}
${HOST}${ARROWS}>button{align-items:center;background:var(--openpencil-carousel-background);border:1px solid currentColor;border-radius:50%;color:inherit;display:flex;font-size:24px;height:32px;justify-content:center;line-height:1;padding:0;pointer-events:auto;width:32px}
${HOST}${PAGINATION}{align-items:center;bottom:0;box-sizing:border-box;display:flex;gap:0;height:36px;left:12px;overflow-x:auto;overflow-y:hidden;padding:0 2px;position:absolute;right:12px;scrollbar-width:none;z-index:2}
${HOST}[data-arrows][data-arrow-position=bottom-corners]${PAGINATION}{left:52px;right:52px}
${HOST}[data-arrows][data-arrow-position=bottom-left]${PAGINATION}{left:96px}
${HOST}[data-arrows][data-arrow-position=bottom-right]${PAGINATION}{right:96px}
${HOST}${PAGINATION}::-webkit-scrollbar{display:none}
${HOST}${PAGINATION}>button{align-items:center;background:transparent;border:0;color:inherit;display:flex;flex-shrink:0;height:24px;justify-content:center;padding:0;width:20px}
${HOST}${PAGINATION}>:first-child{margin-left:auto}
${HOST}${PAGINATION}>:last-child{margin-right:auto}
${HOST}${PAGINATION}[data-pagination=dots]>button::before{background:currentColor;border-radius:50%;content:'';height:6px;opacity:.5;width:6px}
${HOST}${PAGINATION}>button[aria-current=true]::before{opacity:1}
${HOST}${PAGINATION}[data-pagination=numbers]{gap:4px}
${HOST}${PAGINATION}[data-pagination=numbers]>button{border-radius:4px;font-size:12px;width:24px}
${HOST}${PAGINATION}[data-pagination=numbers]>button[aria-current=true]{background:var(--openpencil-carousel-accent);color:#fff}
${HOST}${PAGINATION}[data-pagination=fraction]{font-size:12px;white-space:nowrap}
${HOST}${AUTOPLAY}{background:var(--openpencil-carousel-background);border:1px solid currentColor;border-radius:6px;color:inherit;font-size:12px!important;padding:4px 8px;position:absolute;right:8px;top:8px;z-index:3}
${HOST}${MEDIA}>button{background:transparent;border:1px dashed currentColor;border-radius:4px;color:inherit;padding:12px}
${HOST}${LOAD}{inset:0;position:absolute}
${HOST}[data-layout=overlay]${LOAD}{background:var(--openpencil-carousel-background);inset:8px auto auto 8px;max-width:calc(100% - 16px);padding:6px 10px;z-index:4}
${HOST}[data-layout=overlay][data-autoplay]${LOAD}{max-width:calc(100% - 88px)}
@media(prefers-reduced-motion:reduce){${HOST}${SLIDE}{transition:none!important}}
`
