import type { ExprAst } from '@open-pencil/lowcode'

import { safeMiniProgramIdentifier } from '../miniprogram-shared'

export interface WechatExpressionScope {
  names: ReadonlyMap<string, string>
  locals?: ReadonlyMap<string, string>
  staticValues?: ReadonlyMap<string, unknown>
}

export function emitWechatTemplateExpression(ast: ExprAst, scope: WechatExpressionScope): string {
  return emitExpression(ast, scope, 'template')
}

export function emitWechatScriptExpression(ast: ExprAst, scope: WechatExpressionScope): string {
  return emitExpression(ast, scope, 'script')
}

function emitExpression(
  ast: ExprAst,
  scope: WechatExpressionScope,
  runtime: 'template' | 'script'
): string {
  switch (ast.kind) {
    case 'number':
      return Number.isFinite(ast.value) ? String(ast.value) : '0'
    case 'string':
      return sourceString(ast.value)
    case 'ident':
      return emitIdentifier(ast.name, scope, runtime)
    case 'member':
      return `${emitExpression(ast.object, scope, runtime)}[${sourceString(ast.property)}]`
    case 'unary':
      return `(${ast.op}${emitExpression(ast.arg, scope, runtime)})`
    case 'binary':
      return `(${emitExpression(ast.left, scope, runtime)} ${templateOperator(ast.op, runtime)} ${emitExpression(ast.right, scope, runtime)})`
    case 'ternary':
      return `(${emitExpression(ast.test, scope, runtime)} ? ${emitExpression(ast.consequent, scope, runtime)} : ${emitExpression(ast.alternate, scope, runtime)})`
    case 'template': {
      const parts: string[] = []
      for (const [index, quasi] of ast.quasis.entries()) {
        if (quasi) parts.push(sourceString(quasi))
        if (index < ast.expressions.length) {
          parts.push(`String(${emitExpression(ast.expressions[index], scope, runtime)})`)
        }
      }
      return parts.length > 0 ? `(${parts.join(' + ')})` : '""'
    }
  }
  throw new TypeError('Unsupported WeChat Mini Program expression')
}

function emitIdentifier(
  name: string,
  scope: WechatExpressionScope,
  runtime: 'template' | 'script'
): string {
  if (scope.staticValues?.has(name)) return sourceValue(scope.staticValues.get(name))
  const local = scope.locals?.get(name)
  if (local) return local
  const alias = scope.names.get(name) ?? builtInDataAlias(name) ?? safeMiniProgramIdentifier(name)
  return runtime === 'template' ? alias : `this.data[${sourceString(alias)}]`
}

function builtInDataAlias(name: string): string | undefined {
  if (name === '$params') return '__routeParams'
  if (name === '$query') return '__query'
  if (name === '$currentUser') return '__currentUser'
  return undefined
}

function templateOperator(operator: string, runtime: 'template' | 'script'): string {
  if (runtime === 'template' && operator === '===') return '=='
  if (runtime === 'template' && operator === '!==') return '!='
  return operator
}

function sourceValue(value: unknown): string {
  if (typeof value === 'string') return sourceString(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return 'undefined'
}

function sourceString(value: string): string {
  return JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}
