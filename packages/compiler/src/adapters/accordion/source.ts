/** Shared, scoped presentation contract for the two generated web runtimes. */
export const ACCORDION_CONFIG_SOURCE = `export interface OpenPencilAccordionItem {
  id: string
  title: string
  content: string
}
export interface OpenPencilAccordionConfig {
  label: string
  items: readonly OpenPencilAccordionItem[]
  allowMultiple: boolean
  initialOpenIds: readonly string[]
  showDividers: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  fontSize: number
}
`

const HOST = '[data-openpencil-accordion]'
const HEADER = `${HOST}>section>h3>button`

export const ACCORDION_STYLE_SOURCE = `${HOST}{min-width:0;min-height:0;overflow:auto}
${HOST}>section{border-bottom:var(--openpencil-accordion-divider)}
${HOST}>section>h3{margin:0}
${HEADER}{align-items:center;background:transparent;border:0;color:inherit;cursor:pointer;display:flex;font:600 var(--openpencil-accordion-font-size)/1.4 system-ui,sans-serif;gap:12px;justify-content:space-between;min-height:44px;padding:12px 16px;text-align:start;width:100%;box-sizing:border-box}
${HEADER}>span:first-child{min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}
${HEADER}>span:last-child{color:var(--openpencil-accordion-accent);flex-shrink:0;width:16px;text-align:center}
${HEADER}:focus-visible{outline:2px solid var(--openpencil-accordion-accent);outline-offset:-3px}
${HOST}>section>[data-accordion-panel]{font:var(--openpencil-accordion-font-size)/1.6 system-ui,sans-serif;padding:0 16px 16px;overflow-wrap:anywhere;white-space:pre-wrap}
`
