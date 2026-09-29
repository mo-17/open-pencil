export const BREADCRUMB_CONFIG_SOURCE = `export interface OpenPencilBreadcrumbConfig {
  label: string
  items: readonly { label: string; href: string }[]
  separator: 'slash' | 'chevron' | 'dot'
  wrap: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  fontSize: number
}
function breadcrumbHref(value: string): string | undefined {
  if (!value || value.length > 2048 || value.includes('\\\\') || /[\\u0000-\\u001f\\u007f]/.test(value)) return undefined
  if (value.startsWith('/') && !value.startsWith('//')) return value
  if (value.startsWith('#') && value.length > 1) return value
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password && url.href === value) return value
  } catch { /* Invalid links remain noninteractive text. */ }
  return undefined
}
function breadcrumbSeparator(value: OpenPencilBreadcrumbConfig['separator']): string {
  return value === 'slash' ? '/' : value === 'dot' ? '·' : '›'
}
`
const HOST = '[data-openpencil-breadcrumb]'
export const BREADCRUMB_STYLE_SOURCE = `${HOST}{box-sizing:border-box;min-width:0;min-height:0;overflow:auto;font:var(--op-crumb-font)/1.4 system-ui,sans-serif}
${HOST}>ol{display:flex;align-items:center;list-style:none;margin:0;padding:6px 12px;gap:4px 8px;box-sizing:border-box;min-width:0;flex-wrap:var(--op-crumb-wrap)}
${HOST}>ol>li{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;flex:0 1 auto;min-height:44px}
${HOST}>ol>li>[data-crumb-label]{min-width:0;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
${HOST}>ol>li>[data-crumb-separator]{flex:none;opacity:.55}
${HOST}>ol>li>a{color:var(--op-crumb-accent);text-decoration:none;padding:10px 0;border-radius:3px}
${HOST}>ol>li>a:hover{text-decoration:underline}
${HOST}>ol>li>a:focus-visible{outline:2px solid var(--op-crumb-accent);outline-offset:2px}
${HOST}>ol>li>[aria-current=page]{font-weight:600}
`
