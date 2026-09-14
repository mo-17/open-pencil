import type { templateCommandRecoveryActions } from '@/app/lowcode/backend/template-command-recovery'

import type { commerceCopy } from '../copy'
import type { CommerceLayout } from '../layout'

export function createCommerceRecoverySection(
  layout: CommerceLayout,
  copy: ReturnType<typeof commerceCopy>,
  parent: string,
  y: number,
  options: {
    info: string
    busy: string
    display: string
    actions: ReturnType<typeof templateCommandRecoveryActions>
    cancellation?: boolean
    acknowledgeLabel?: string
  }
) {
  const { text, button } = layout
  const { info, busy, display, actions } = options
  text(parent, copy.recoveryTitle, 48, y)
  button(parent, copy.inspect, 48, y + 42, actions.startInspect, { renderCondition: `!${busy}` })
  text(parent, copy.recoveryUninspected, 48, y + 98, 860, {
    height: 64,
    bindings: {
      text: {
        kind: 'expr',
        expr: `${info}.status === "recorded" ? ${display} : ${info}.status === "incompatible" ? ${JSON.stringify(copy.recoveryIncompatible)} : ${info}.status === "empty" ? ${JSON.stringify(copy.recoveryEmpty)} : ${JSON.stringify(copy.recoveryUninspected)}`
      }
    }
  })
  text(parent, '', 48, y + 174, 860, {
    height: 48,
    renderCondition: `!!${info}.key`,
    bindings: {
      text: { kind: 'expr', expr: `${JSON.stringify(copy.savedKey + ': ')} + ${info}.key` }
    }
  })
  button(parent, copy.retry, 48, y + 236, actions.startRetry, {
    renderCondition: `${info}.status === "recorded" && !${busy}`
  })
  button(
    parent,
    options.acknowledgeLabel ?? (options.cancellation ? copy.newCancellation : copy.newOrder),
    300,
    y + 236,
    [actions.confirm],
    {
      renderCondition: `!!${info}.key && !${busy}`
    }
  )
}
