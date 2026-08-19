import type { IRControlledInput, IREventHandler, IRNavigateHandler } from '#compiler/ir/types'

import { lowcodeNavigationPathname } from '@open-pencil/lowcode'

import type { MiniProgramWarningSink } from '../miniprogram-shared'
import { emitWechatScriptExpression, type WechatExpressionScope } from './expression'

export interface WechatEventContext {
  sourceId: string
  warn: MiniProgramWarningSink
  expressionScope: WechatExpressionScope
  routeMap: ReadonlyMap<string, string>
}

export function emitWechatEventStatements(
  handlers: readonly IREventHandler[],
  context: WechatEventContext
): string[] {
  return handlers.flatMap((handler) => emitHandler(handler, context))
}

export function emitWechatControlledInputStatement(
  controlled: IRControlledInput,
  context: WechatEventContext
): string | undefined {
  if (controlled.write.kind !== 'state') {
    context.warn({
      code: 'wechat-miniprogram-document-state-unsupported',
      message: 'WeChat Mini Program export omitted a controlled write to document state',
      nodeId: context.sourceId
    })
    return undefined
  }
  const alias = context.expressionScope.names.get(controlled.write.name)
  if (!alias) {
    context.warn({
      code: 'wechat-miniprogram-state-reference-unavailable',
      message:
        'WeChat Mini Program export omitted a controlled write whose page state is unavailable',
      nodeId: context.sourceId
    })
    return undefined
  }
  const value = controlledInputValue(controlled.write.targetType)
  if (!value) {
    context.warn({
      code: 'wechat-miniprogram-array-control-unsupported',
      message: 'WeChat Mini Program export omitted an array-valued controlled input',
      nodeId: context.sourceId
    })
    return undefined
  }
  return `this.setData({ [${JSON.stringify(alias)}]: ${value} });`
}

function emitHandler(handler: IREventHandler, context: WechatEventContext): string[] {
  switch (handler.kind) {
    case 'setState': {
      const alias = context.expressionScope.names.get(handler.stateName)
      if (!alias) {
        context.warn({
          code: 'wechat-miniprogram-state-reference-unavailable',
          message:
            'WeChat Mini Program export omitted a state update whose page state is unavailable',
          nodeId: context.sourceId
        })
        return []
      }
      const expressionScope =
        handler.mode === 'functional'
          ? {
              ...context.expressionScope,
              locals: new Map([...(context.expressionScope.locals ?? []), ['prev', 'prev']])
            }
          : context.expressionScope
      const expression = emitWechatScriptExpression(handler.ast, expressionScope)
      return handler.mode === 'functional'
        ? [
            `const prev = this.data[${JSON.stringify(alias)}];`,
            `this.setData({ [${JSON.stringify(alias)}]: ${expression} });`
          ]
        : [`this.setData({ [${JSON.stringify(alias)}]: ${expression} });`]
    }
    case 'navigate':
      return emitNavigate(handler, context)
    case 'condition':
      return emitConditionalHandler(handler, context)
    case 'toast': {
      const title = emitWechatScriptExpression(handler.ast, context.expressionScope)
      return [`wx.showToast({ title: String(${title}).slice(0, 32), icon: 'none' });`]
    }
    case 'stop':
      return ['return;']
    default:
      context.warn({
        code: 'wechat-miniprogram-action-unsupported',
        message: `WeChat Mini Program export omitted unsupported ${handler.kind} action`,
        nodeId: context.sourceId
      })
      return []
  }
}

function emitConditionalHandler(
  handler: Extract<IREventHandler, { kind: 'condition' }>,
  context: WechatEventContext
): string[] {
  const consequent = handler.consequent.flatMap((nested) => emitHandler(nested, context))
  const alternate = (handler.alternate ?? []).flatMap((nested) => emitHandler(nested, context))
  if (consequent.length === 0 && alternate.length === 0) return []
  const condition = emitWechatScriptExpression(handler.condAst, context.expressionScope)
  const alternateBody = alternate.length > 0 ? ` else { ${alternate.join(' ')} }` : ''
  return [`if (${condition}) { ${consequent.join(' ')} }${alternateBody}`]
}

function emitNavigate(handler: IRNavigateHandler, context: WechatEventContext): string[] {
  const authoredPath = lowcodeNavigationPathname(handler.to)
  const route = context.routeMap.get(normalizeRoute(authoredPath))
  if (!route) {
    context.warn({
      code: 'wechat-miniprogram-navigation-target-unavailable',
      message: 'WeChat Mini Program export omitted navigation to an unavailable page route',
      nodeId: context.sourceId
    })
    return []
  }
  const suffix = handler.to.slice(authoredPath.length)
  if (suffix) {
    context.warn({
      code: 'wechat-miniprogram-navigation-suffix-unsupported',
      message: 'WeChat Mini Program export omitted an authored query or fragment from navigation',
      nodeId: context.sourceId
    })
  }
  const params = handler.params ?? []
  if (params.length === 0) return [`wx.navigateTo({ url: ${JSON.stringify(`/${route}`)} });`]
  const query = params
    .map(
      (parameter) =>
        `${JSON.stringify(`${encodeURIComponent(parameter.name)}=`)} + encodeURIComponent(String(${emitWechatScriptExpression(parameter.ast, context.expressionScope)}))`
    )
    .join(` + '&' + `)
  return [
    `const query = ${query};`,
    `wx.navigateTo({ url: ${JSON.stringify(`/${route}?`)} + query });`
  ]
}

function controlledInputValue(
  targetType: IRControlledInput['write']['targetType']
): string | undefined {
  if (targetType === 'string') return 'String(event.detail.value ?? "")'
  if (targetType === 'number') return 'Number(event.detail.value)'
  if (targetType === 'boolean') return 'Boolean(event.detail.value)'
  return undefined
}

function normalizeRoute(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}
