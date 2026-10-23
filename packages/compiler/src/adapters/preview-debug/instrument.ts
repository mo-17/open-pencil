/** Dev preview instrumentation carries identifiers and phases, never expression values. */
export interface PreviewDebugEvent {
  nodeId: string
  event: string
}

export function previewDebugBegin(debug: PreviewDebugEvent | undefined): string {
  return debug
    ? `const __opTrace = window.__opLowcodeDebug?.begin(${JSON.stringify(debug.nodeId)}, ${JSON.stringify(debug.event)}) ?? 0;`
    : ''
}

export function previewDebugStep(
  trace: boolean,
  kind: 'action' | 'state',
  label: string,
  status: 'start' | 'success' | 'error' | 'changed'
): string {
  return trace
    ? `window.__opLowcodeDebug?.step(__opTrace, '${kind}', ${JSON.stringify(label)}, '${status}');`
    : ''
}

export function previewDebugAction(statement: string, kind: string, trace: boolean): string {
  if (!trace) return statement
  return `{ ${previewDebugStep(true, 'action', kind, 'start')} let __opActionFailed = false; try { ${statement} } catch (__opDebugError) { __opActionFailed = true; ${previewDebugStep(true, 'action', kind, 'error')} throw __opDebugError; } finally { if (!__opActionFailed) { ${previewDebugStep(true, 'action', kind, 'success')} } } }`
}

export function previewDebugExpression(expression: string, trace: boolean): string {
  return trace
    ? `(window.__opLowcodeDebug ? window.__opLowcodeDebug.expression(__opTrace, () => (${expression})) : (${expression}))`
    : expression
}
