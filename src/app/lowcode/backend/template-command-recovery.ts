import type { ActionDef, BackendCommandRecoveryAction, StateDef } from '@open-pencil/scene-graph'

export function templateCommandRecoveryActions(options: {
  commandId: string
  keyTarget: string
  infoTarget: string
  resultTarget: string
  displayTarget: string
  displayExpr: string
  errorTarget: string
  busy: StateDef
  acknowledged: ActionDef[]
  confirmation: string
  started?: ActionDef[]
}) {
  const busy = (value: boolean): ActionDef => ({
    id: crypto.randomUUID(),
    kind: 'setState',
    targetStateId: options.busy.id,
    valueExpr: value ? '!0' : '!1'
  })
  const base = {
    kind: 'backendCommandRecovery' as const,
    commandId: options.commandId,
    idempotencyKeyTarget: options.keyTarget,
    errorTarget: options.errorTarget
  }
  const display = (valueExpr: string): ActionDef => ({
    id: crypto.randomUUID(),
    kind: 'setVariable',
    targetName: options.displayTarget,
    valueExpr
  })
  const inspect = (): BackendCommandRecoveryAction => ({
    ...base,
    id: crypto.randomUUID(),
    operation: 'inspect',
    resultTarget: options.infoTarget,
    onSuccess: [display(options.displayExpr), busy(false)],
    onError: [display('""'), busy(false)]
  })
  const retry: BackendCommandRecoveryAction = {
    ...base,
    id: crypto.randomUUID(),
    operation: 'retry',
    attemptKeyExpr: `${options.infoTarget}.key`,
    resultTarget: options.resultTarget,
    onSuccess: [inspect()],
    onError: [inspect()]
  }
  const acknowledge: BackendCommandRecoveryAction = {
    ...base,
    id: crypto.randomUUID(),
    operation: 'acknowledge',
    attemptKeyExpr: `${options.infoTarget}.key`,
    resultTarget: options.infoTarget,
    onSuccess: [...options.acknowledged, display('""'), busy(false)],
    onError: [busy(false)]
  }
  const confirm: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'confirm',
    messageExpr: JSON.stringify(options.confirmation),
    consequent: [...(options.started ?? []), busy(true), acknowledge]
  }
  return {
    inspect,
    startInspect: [...(options.started ?? []), busy(true), inspect()],
    retry,
    acknowledge,
    confirm,
    startRetry: [...(options.started ?? []), busy(true), retry]
  }
}
