import { HTML_MODULE_SANDBOX_CSP } from '@open-pencil/core/plugins'

/** Both web targets keep authored markup inside the same empty-sandbox iframe. */
export function htmlSandboxSource(exportConstant: boolean): string {
  return `${exportConstant ? 'export ' : ''}const OPENPENCIL_HTML_SANDBOX_CSP = ${JSON.stringify(HTML_MODULE_SANDBOX_CSP)}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function buildSandboxDocument(html: string): string {
  const policy = escapeAttribute(OPENPENCIL_HTML_SANDBOX_CSP)
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + policy + '">' + html
}
`
}
