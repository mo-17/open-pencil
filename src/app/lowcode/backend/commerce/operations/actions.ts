import type { BackendCommerceOperation } from '@open-pencil/lowcode/backend'
import type { ActionDef, ActionPayloadEntry } from '@open-pencil/scene-graph'

import { templateCommandRecoveryActions } from '@/app/lowcode/backend/template-command-recovery'

import { setCommerceState as set, setCommerceVariable as variable } from '../state'
import type { OperationsScreen } from './screen'

/** Commands and retries retain the reviewed server operation, original payload and account. */
export function createOperation(
  screen: OperationsScreen,
  operation: BackendCommerceOperation,
  payloadEntries: ActionPayloadEntry[],
  condition: string,
  label: string
) {
  const { ctx, field, error } = screen
  const { copy: c, layout: l } = ctx
  const definition = ctx.application.commands?.commands.find(
    (entry) => entry.commerceOperation === operation
  )
  if (!definition) throw new Error('Missing reviewed commerce operation: ' + operation)
  const prefix = operation.replace(/\./gu, '')
  const busy = field(prefix + 'Busy', 'boolean', false)
  const generation = field(prefix + 'Generation')
  const key = ctx.doc(prefix + 'Attempt')
  const info = ctx.doc(prefix + 'Recovery', 'object')
  const result = ctx.doc(prefix + 'Result', 'object')
  const display = ctx.doc(prefix + 'Display')
  const running = `(${busy.name} && ${generation.name} === ("" + $currentUser.generation))`
  const locked = `(${running} || ${key} !== "" || !!${info}.key)`
  const started = [set(generation, '"" + $currentUser.generation')]
  const recovery = templateCommandRecoveryActions({
    commandId: definition.id,
    keyTarget: key,
    infoTarget: info,
    resultTarget: result,
    displayTarget: display,
    displayExpr: JSON.stringify(label),
    errorTarget: error,
    busy,
    started,
    confirmation: c.acknowledgeHint,
    acknowledged: [variable(error, '""'), screen.clearSelection]
  })
  const command: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'backendCommand',
    commandId: definition.id,
    payloadEntries,
    idempotencyKeyTarget: key,
    recovery: 'browser',
    resultTarget: result,
    errorTarget: error,
    onSuccess: [recovery.inspect()],
    onError: [recovery.inspect()]
  }
  const allowed = `($currentUser.signedIn && ${condition} && !${locked})`
  const submit: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'condition',
    condExpr: allowed,
    consequent: [
      ...started,
      set(busy, '!0'),
      {
        id: crypto.randomUUID(),
        kind: 'confirm',
        messageExpr: JSON.stringify(c.confirm + ' ' + label),
        confirmLabel: label,
        cancelLabel: ctx.baseCopy.keepEditing,
        consequent: [variable(error, '""'), command],
        alternate: [set(busy, '!1')]
      }
    ]
  }
  const feedback = (y: number) => {
    l.text(screen.page, c.busy, 48, y, 880, { renderCondition: running })
    screen.bound(
      screen.page,
      `${result}.id ? ${JSON.stringify(c.result + ': ')} + ${result}.id + " · " + (${result}.status || "") : ""`,
      y + 40,
      48
    )
    l.text(screen.page, c.recovery, 48, y + 94, 880, { height: 54, fontSize: 13 })
    l.button(screen.page, c.inspect + ' · ' + label, 48, y + 152, recovery.startInspect, {
      width: 290,
      renderCondition: `!${running}`
    })
    screen.bound(
      screen.page,
      `${info}.key ? ${JSON.stringify(c.saved + ': ')} + ${info}.key : ${info}.status === "empty" ? ${JSON.stringify(c.empty)} : ${info}.status === "incompatible" ? ${JSON.stringify(c.unavailable)} : ${JSON.stringify(c.notInspected)}`,
      y + 210,
      50
    )
    l.button(screen.page, c.retry, 48, y + 276, recovery.startRetry, {
      renderCondition: `${info}.status === "recorded" && !${running}`
    })
    l.button(screen.page, c.acknowledge, 300, y + 276, [recovery.confirm], {
      width: 260,
      renderCondition: `!!${info}.key && !${running}`
    })
  }
  return { locked, allowed, submit, result, feedback }
}
