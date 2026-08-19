import type { IRControlledInput, IRElement, IREventHandler, IREventName } from '#compiler/ir/types'

import type { MiniProgramWarningSink } from '../miniprogram-shared'
import { emitTaroExpression, type TaroExpressionBindings } from './expression'

interface TaroEventEnvironment {
  expressionBindings: TaroExpressionBindings
  routeByAuthoredPath: ReadonlyMap<string, string>
  stateNames: ReadonlySet<string>
  warn: MiniProgramWarningSink
}

const UNSUPPORTED_ACTION_KIND = new Set<IREventHandler['kind']>([
  'apiCall',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  'confirm',
  'trackEvent',
  'stripeCheckout',
  'stripeCustomerPortal',
  'invokeServerWorkflow',
  'playMotion',
  'stopMotion',
  'toggleMotion',
  'awaitMotion'
])

export function emitTaroEventAttributes(
  node: IRElement,
  component: string,
  environment: TaroEventEnvironment
): string[] {
  const result: string[] = []
  const events = node.events ?? {}
  const controlled = emitControlledEvent(
    node.controlled,
    component,
    events.onChange,
    node.sourceId,
    environment
  )
  if (controlled) result.push(controlled)
  for (const [eventName, handlers] of Object.entries(events) as Array<
    [IREventName, IREventHandler[]]
  >) {
    if (eventName === 'onChange' && controlled) continue
    const prop = taroEventProp(eventName, component)
    const statements = emitHandlerStatements(handlers, node.sourceId, environment)
    if (statements.length === 0) continue
    const async = statements.some((statement) => statement.includes('await ')) ? 'async ' : ''
    result.push(`${prop}={${async}() => { ${statements.join(' ')} }}`)
  }
  return result
}

function emitControlledEvent(
  controlled: IRControlledInput | undefined,
  component: string,
  onChange: IREventHandler[] | undefined,
  sourceId: string,
  environment: TaroEventEnvironment
): string | undefined {
  if (!controlled) return undefined
  const { write } = controlled
  if (
    write.kind !== 'state' ||
    !environment.stateNames.has(write.name) ||
    write.targetType === 'array'
  ) {
    environment.warn({
      code: 'taro-controlled-state-target-unsupported',
      message: `Taro omitted controlled write to ${write.kind} ${JSON.stringify(write.name)}`,
      nodeId: sourceId
    })
    return undefined
  }
  const eventProp = component === 'Input' || component === 'Textarea' ? 'onInput' : 'onChange'
  let value = 'String(event.detail.value)'
  if (write.targetType === 'boolean') value = 'Boolean(event.detail.value)'
  else if (write.targetType === 'number') value = 'Number(event.detail.value)'
  const statements = [
    `${taroStateSetter(write.name)}(${value});`,
    ...emitHandlerStatements(onChange ?? [], sourceId, environment)
  ]
  return `${write.targetType === 'boolean' ? 'checked' : 'value'}={${controlled.read}} ${eventProp}={(event) => { ${statements.join(' ')} }}`
}

function taroEventProp(name: IREventName, component: string): string {
  if (name === 'onChange' && (component === 'Input' || component === 'Textarea')) return 'onInput'
  return name
}

function emitHandlerStatements(
  handlers: readonly IREventHandler[],
  nodeId: string,
  environment: TaroEventEnvironment
): string[] {
  const statements: string[] = []
  for (const handler of handlers) {
    if (UNSUPPORTED_ACTION_KIND.has(handler.kind)) {
      environment.warn({
        code: `taro-action-${handler.kind}-unsupported`,
        message: `Taro omitted unsupported ${handler.kind} action`,
        nodeId
      })
      continue
    }
    switch (handler.kind) {
      case 'setState':
        if (!environment.stateNames.has(handler.stateName)) {
          environment.warn({
            code: 'taro-component-local-state-action-unsupported',
            message: `Taro omitted setState for unavailable state ${JSON.stringify(handler.stateName)}`,
            nodeId
          })
          break
        }
        statements.push(
          `${taroStateSetter(handler.stateName)}(${handler.mode === 'functional' ? `(prev) => ${emitTaroExpression(handler.ast, environment.expressionBindings)}` : emitTaroExpression(handler.ast, environment.expressionBindings)});`
        )
        break
      case 'setVariable':
        environment.warn({
          code: 'taro-document-state-action-unsupported',
          message: `Taro omitted document-state write ${JSON.stringify(handler.docStateName)}`,
          nodeId
        })
        break
      case 'navigate': {
        const route = environment.routeByAuthoredPath.get(handler.to)
        if (!route) {
          environment.warn({
            code: 'taro-navigate-target-unavailable',
            message: `Taro omitted navigation to unknown route ${JSON.stringify(handler.to)}`,
            nodeId
          })
          break
        }
        const query = (handler.params ?? [])
          .map(
            (param) =>
              `${encodeURIComponent(param.name)}=\${encodeURIComponent(String(${emitTaroExpression(param.ast, environment.expressionBindings)}))}`
          )
          .join('&')
        const url = query ? `\`/${route}?${query}\`` : JSON.stringify(`/${route}`)
        statements.push(`void Taro.navigateTo({ url: ${url} });`)
        break
      }
      case 'condition': {
        const consequent = emitHandlerStatements(handler.consequent, nodeId, environment).join(' ')
        const alternate = emitHandlerStatements(handler.alternate ?? [], nodeId, environment).join(
          ' '
        )
        statements.push(
          `if (${emitTaroExpression(handler.condAst, environment.expressionBindings)}) { ${consequent} }${alternate ? ` else { ${alternate} }` : ''}`
        )
        break
      }
      case 'delay':
        statements.push(`await new Promise((resolve) => setTimeout(resolve, ${handler.ms}));`)
        break
      case 'stop':
        statements.push('return;')
        break
      case 'toast':
        statements.push(
          `void Taro.showToast({ title: String(${emitTaroExpression(handler.ast, environment.expressionBindings)}), icon: 'none', duration: ${handler.durationMs ?? 3000} });`
        )
        break
      case 'clipboard':
        statements.push(
          `void Taro.setClipboardData({ data: String(${emitTaroExpression(handler.ast, environment.expressionBindings)}) });`
        )
        break
    }
  }
  return statements
}

export function taroStateSetter(name: string): string {
  return `set${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
}
