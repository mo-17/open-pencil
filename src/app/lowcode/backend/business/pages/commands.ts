import type { ActionDef, ActionPayloadEntry } from '@open-pencil/scene-graph'

import { templateCommandRecoveryActions } from '@/app/lowcode/backend/template-command-recovery'

import type { BusinessActionDefinition } from '../types'
import type { BusinessScreen } from './screen'
import { businessSet, businessVariable } from './state'

export function createBusinessCommand(
  screen: BusinessScreen,
  definition: BusinessActionDefinition,
  payloadEntries: ActionPayloadEntry[],
  condition: string
) {
  const { ctx } = screen
  const { copy } = ctx
  const label = ctx.label(definition.label)
  const busy = screen.field(definition.id + 'Busy', 'boolean', false)
  const generation = screen.field(definition.id + 'Generation')
  const key = ctx.doc(screen.definition.id + definition.id + 'Attempt')
  const info = ctx.doc(screen.definition.id + definition.id + 'Recovery', 'object')
  const result = ctx.doc(screen.definition.id + definition.id + 'Result', 'object')
  const display = ctx.doc(screen.definition.id + definition.id + 'Display')
  const running = `(${busy.name} && ${generation.name} === ("" + $currentUser.generation))`
  const locked = `(${running} || ${key} !== "" || !!${info}.key)`
  const started = [businessSet(generation, '"" + $currentUser.generation')]
  const recovery = templateCommandRecoveryActions({
    commandId: definition.commandId,
    keyTarget: key,
    infoTarget: info,
    resultTarget: result,
    displayTarget: display,
    displayExpr: JSON.stringify(label),
    errorTarget: screen.error,
    busy,
    started,
    confirmation: copy.acknowledgeHint,
    acknowledged: [
      businessVariable(screen.error, '""'),
      screen.clearSelection,
      businessSet(screen.generation, '""')
    ]
  })
  const command: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'backendCommand',
    commandId: definition.commandId,
    payloadEntries,
    idempotencyKeyTarget: key,
    recovery: 'browser',
    resultTarget: result,
    errorTarget: screen.error,
    onSuccess: [screen.clearSelection, recovery.inspect()],
    onError: [recovery.inspect()]
  }
  const allowed = `($currentUser.signedIn && ${screen.current} && ${condition} && !${locked})`
  const submit: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'condition',
    condExpr: allowed,
    consequent: [
      ...started,
      businessSet(busy, '!0'),
      {
        id: crypto.randomUUID(),
        kind: 'confirm',
        messageExpr: JSON.stringify(copy.confirm + ' ' + label),
        confirmLabel: label,
        cancelLabel: copy.keepEditing,
        consequent: [businessVariable(screen.error, '""'), command],
        alternate: [businessSet(busy, '!1')]
      }
    ]
  }
  return { submit, allowed, locked, running, recovery, key, info, result }
}

export function renderBusinessCommandFeedback(
  screen: BusinessScreen,
  parent: string,
  y: number,
  definition: BusinessActionDefinition,
  command: ReturnType<typeof createBusinessCommand>
): void {
  const { ctx } = screen
  const { copy, layout } = ctx
  const bound = (expr: string, offset: number, height: number) =>
    layout.text(
      parent,
      '',
      { x: 0, y: y + offset, width: 820, height },
      { bindings: { text: { kind: 'expr', expr } } }
    )
  layout.text(
    parent,
    copy.busy,
    { x: 0, y, width: 820, height: 32 },
    { renderCondition: command.running }
  )
  bound(
    `${command.result}.id ? ${JSON.stringify(copy.result + ': ')} + ${command.result}.id : ""`,
    42,
    40
  )
  layout.text(parent, copy.recovery, { x: 0, y: y + 94, width: 820, height: 54 }, { fontSize: 14 })
  layout.button(
    parent,
    copy.inspect + ' · ' + ctx.label(definition.label),
    { x: 0, y: y + 158, width: 360, height: 44 },
    command.recovery.startInspect,
    { renderCondition: `!${command.running}` }
  )
  bound(
    `${command.info}.key ? ${JSON.stringify(copy.saved + ': ')} + ${command.info}.key : ${command.info}.status === "empty" ? ${JSON.stringify(copy.empty)} : ${command.info}.status === "incompatible" ? ${JSON.stringify(copy.incompatible)} : ${JSON.stringify(copy.notInspected)}`,
    218,
    54
  )
  layout.button(
    parent,
    copy.retry,
    { x: 0, y: y + 286, width: 220, height: 44 },
    command.recovery.startRetry,
    { renderCondition: `${command.info}.status === "recorded" && !${command.running}` }
  )
  layout.button(
    parent,
    copy.acknowledge,
    { x: 248, y: y + 286, width: 280, height: 44 },
    [command.recovery.confirm],
    { renderCondition: `!!${command.info}.key && !${command.running}` }
  )
}
