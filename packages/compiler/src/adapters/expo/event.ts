import type { IREventHandler, IRNavigateHandler } from '#compiler/ir/types'

import { emitExpression, lowcodeNavigationPathname } from '@open-pencil/lowcode'

import type { ExpoWarningSink } from './types'

export interface ExpoEventContext {
  router: boolean
  routeRewrites: ReadonlyMap<string, string>
  sourceId: string
  warn: ExpoWarningSink
}

export function emitExpoEventHandler(
  handlers: readonly IREventHandler[],
  context: ExpoEventContext,
  trailingStatements: readonly string[] = []
): string | undefined {
  const statements = [
    ...handlers.flatMap((handler) => emitHandler(handler, context)),
    ...trailingStatements
  ]
  if (statements.length === 0) return undefined
  return `() => { ${statements.join(' ')} }`
}

function emitHandler(handler: IREventHandler, context: ExpoEventContext): string[] {
  switch (handler.kind) {
    case 'setState': {
      const setter = setterName(handler.stateName)
      const expression = emitExpression(handler.ast)
      return [
        handler.mode === 'functional'
          ? `${setter}((prev) => ${expression});`
          : `${setter}(${expression});`
      ]
    }
    case 'setVariable': {
      const expression = emitExpression(handler.ast)
      return [
        handler.mode === 'functional'
          ? `setDocState(${JSON.stringify(handler.docStateName)}, (prev) => ${expression});`
          : `setDocState(${JSON.stringify(handler.docStateName)}, ${expression});`
      ]
    }
    case 'navigate':
      return emitNavigate(handler, context)
    case 'condition': {
      const consequent = handler.consequent.flatMap((nested) => emitHandler(nested, context))
      const alternate = (handler.alternate ?? []).flatMap((nested) => emitHandler(nested, context))
      if (consequent.length === 0 && alternate.length === 0) return []
      const elseArm = alternate.length > 0 ? ` else { ${alternate.join(' ')} }` : ''
      return [`if (${emitExpression(handler.condAst)}) { ${consequent.join(' ')} }${elseArm}`]
    }
    case 'stop':
      return ['return;']
    default:
      context.warn({
        code: 'expo-action-unsupported',
        message: `Expo static MVP dropped ${handler.kind} action`,
        nodeId: context.sourceId
      })
      return []
  }
}

function emitNavigate(handler: IRNavigateHandler, context: ExpoEventContext): string[] {
  if (!context.router) {
    context.warn({
      code: 'expo-navigate-router-required',
      message: `Expo target dropped navigate(${JSON.stringify(handler.to)}) because router is 'none'`,
      nodeId: context.sourceId
    })
    return []
  }
  const authoredPathname = lowcodeNavigationPathname(handler.to)
  const suffix = handler.to.slice(authoredPathname.length)
  const pathname = `${context.routeRewrites.get(authoredPathname) ?? expoRoutePath(authoredPathname)}${suffix}`
  if (!handler.params || handler.params.length === 0) {
    return [`router.push(${JSON.stringify(pathname)});`]
  }
  const params = handler.params
    .map((param) => `${JSON.stringify(param.name)}: String(${emitExpression(param.ast)})`)
    .join(', ')
  return [`router.push({ pathname: ${JSON.stringify(pathname)}, params: { ${params} } });`]
}

export function expoRoutePath(route: string): string {
  return route
    .split('/')
    .map((segment) => (segment.startsWith(':') ? `[${segment.slice(1)}]` : segment))
    .join('/')
}

export function setterName(stateName: string): string {
  return `set${stateName.charAt(0).toUpperCase()}${stateName.slice(1)}`
}
