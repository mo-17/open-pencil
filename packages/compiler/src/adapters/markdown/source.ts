export const MARKDOWN_CONFIG_SOURCE = `export interface OpenPencilMarkdownConfig {
  source: string
  flavor: 'commonmark' | 'gfm'
  linkTarget: 'same-tab' | 'new-tab'
  backgroundColor: string
  textColor: string
  headingColor: string
  accentColor: string
  fontSize: number
  lineHeight: number
}`

export const MARKDOWN_SAFE_HREF_SOURCE = `function safeHref(value: string): string {
  if (value === '' || value.trim() !== value || /[\\u0000-\\u001F\\u007F\\\\]/.test(value)) return ''
  if (value.startsWith('#')) return /^#[A-Za-z0-9._:-]*$/.test(value) ? value : ''
  if (value.startsWith('/')) {
    if (value.startsWith('//')) return ''
    try {
      const decoded = decodeURIComponent(value).toLowerCase()
      if (decoded.split('/').some((part) => part === '.' || part === '..')) return ''
    } catch {
      return ''
    }
    return value
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return ''
  }
  const hostname = parsed.hostname.toLowerCase()
  const local =
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
  const ipLiteral = /^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(hostname) || hostname.includes(':')
  return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' &&
    (parsed.port === '' || parsed.port === '443') && !local && !ipLiteral && parsed.href === value
    ? value
    : ''
}`

export const MARKDOWN_STYLE_SOURCE = `[data-openpencil-markdown]{box-sizing:border-box;min-width:0;max-width:100%;overflow:auto;padding:16px;overflow-wrap:anywhere;font-family:system-ui,sans-serif}
[data-openpencil-markdown] [data-markdown-body]>*:first-child{margin-top:0}
[data-openpencil-markdown] [data-markdown-body]>*:last-child{margin-bottom:0}
[data-openpencil-markdown] :is(h1,h2,h3,h4,h5,h6){font-weight:600;line-height:1.25;color:var(--op-md-heading);margin:1em 0 .5em}
[data-openpencil-markdown] h1{font-size:2em}[data-openpencil-markdown] h2{font-size:1.5em}[data-openpencil-markdown] h3{font-size:1.25em}[data-openpencil-markdown] :is(h4,h5,h6){font-size:1em}
[data-openpencil-markdown] p{margin:.65em 0}
[data-openpencil-markdown] :is(ul,ol){padding-inline-start:1.5em;margin:.6em 0}
[data-openpencil-markdown] ul{list-style:disc}[data-openpencil-markdown] ol{list-style:decimal}
[data-openpencil-markdown] .contains-task-list{list-style:none;padding-inline-start:.25em}
[data-openpencil-markdown] .task-list-item input{margin-inline-end:.5em}
[data-openpencil-markdown] a{color:var(--op-md-accent);text-decoration:underline}
[data-openpencil-markdown] a:focus-visible{outline:2px solid var(--op-md-accent);outline-offset:2px}
[data-openpencil-markdown] blockquote{border-inline-start:3px solid var(--op-md-accent);margin-inline:0;padding-inline-start:12px}
[data-openpencil-markdown] code{background:var(--op-md-code);border-radius:4px;padding:.1em .3em;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
[data-openpencil-markdown] pre{background:var(--op-md-code);border-radius:6px;padding:12px;overflow:auto;white-space:pre;max-width:100%;margin:.75em 0}
[data-openpencil-markdown] pre code{background:none;padding:0;white-space:pre}
[data-openpencil-markdown] [data-markdown-table]{overflow-x:auto;max-width:100%}
[data-openpencil-markdown] table{border-collapse:collapse;width:100%;font-size:inherit}
[data-openpencil-markdown] :is(th,td){border:1px solid var(--op-md-border);padding:6px}
[data-openpencil-markdown] th{font-weight:600;text-align:start}
[data-openpencil-markdown] hr{border:0;border-top:1px solid var(--op-md-border);margin:1em 0}
[data-openpencil-markdown-image]{display:inline-block;border:1px dashed var(--op-md-border);border-radius:4px;padding:2px 6px}
`
