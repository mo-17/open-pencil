export interface LowcodeActionFocusTarget {
  nodeId: string
  actionId: string
  actionPath: string
}

let pendingTarget: LowcodeActionFocusTarget | null = null

export function requestLowcodeActionFocus(target: LowcodeActionFocusTarget): void {
  pendingTarget = target
}

export function peekLowcodeActionFocus(nodeId: string | undefined): LowcodeActionFocusTarget | null {
  if (!nodeId || pendingTarget?.nodeId !== nodeId) return null
  return pendingTarget
}

export function clearLowcodeActionFocus(target: LowcodeActionFocusTarget): void {
  if (pendingTarget === target) pendingTarget = null
}
