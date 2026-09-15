import type { IREventHandler, IRStateDecl } from '#compiler/ir/types'

import type { ExprAst } from '@open-pencil/lowcode'

import { scriptExpression, type VueEmitContext } from './shared'

type StateType = IRStateDecl['type']

function expressionType(
  ast: ExprAst,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>,
  previousType: StateType | undefined
): StateType | undefined {
  const type = (value: ExprAst) => expressionType(value, context, aliases, previousType)
  if (ast.kind === 'number' || ast.kind === 'string') return ast.kind
  if (ast.kind === 'template') return 'string'
  if (ast.kind === 'ident') {
    if (['true', 'false'].includes(ast.name)) return 'boolean'
    if (ast.name === 'prev' && aliases.get(ast.name) === '__opPrevious') return previousType
    if (aliases.get(ast.name) !== context.identAliases.get(ast.name)) return undefined
    return context.stateTypes.get(ast.name) ?? context.docStateTypes.get(ast.name)
  }
  if (ast.kind === 'member') {
    const parent = type(ast.object)
    return ast.property === 'length' && (parent === 'string' || parent === 'array')
      ? 'number'
      : undefined
  }
  if (ast.kind === 'unary') {
    if (ast.op === '!') return 'boolean'
    return type(ast.arg) === 'number' ? 'number' : undefined
  }
  if (ast.kind === 'ternary') {
    const consequent = type(ast.consequent)
    return consequent === type(ast.alternate) ? consequent : undefined
  }
  return binaryType(ast, type(ast.left), type(ast.right))
}

function binaryType(
  ast: Extract<ExprAst, { kind: 'binary' }>,
  left: StateType | undefined,
  right: StateType | undefined
): StateType | undefined {
  if (ast.op === '&&' || ast.op === '||') return left === right ? left : undefined
  if (['===', '!==', '==', '!=', '<', '>', '<=', '>='].includes(ast.op)) return 'boolean'
  if (ast.op === '+' && (left === 'string' || right === 'string')) return 'string'
  return left === 'number' && right === 'number' ? 'number' : undefined
}

/** Unknown document/API/list values must match the declared destination before changing state. */
export function emitVueStateAssignment(
  stateName: string,
  expression: string,
  ast: ExprAst,
  target: StateType,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>,
  functional = false
): string {
  if (expressionType(ast, context, aliases, functional ? target : undefined) === target)
    return `${stateName}.value = ${expression}`
  const value = '__opNextState'
  const valid = stateTypeGuard(target, value)
  const narrowed = target === 'object' ? `${value} as Record<string, unknown>` : value
  return `{ const ${value}: unknown = ${expression}; if (!(${valid})) throw new TypeError('State value does not match its declared type.'); ${stateName}.value = ${narrowed} }`
}

function stateTypeGuard(target: StateType, value: string): string {
  if (target === 'array') return `Array.isArray(${value})`
  if (target === 'object')
    return `${value} !== null && typeof ${value} === 'object' && !Array.isArray(${value}) && [Object.prototype, null].includes(Object.getPrototypeOf(${value}))`
  return `typeof ${value} === '${target}'`
}

export function emitVueStateHandler(
  handler: Extract<IREventHandler, { kind: 'setState' }>,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string[] {
  const stateName = context.writableStateNames.get(handler.stateName)
  const targetType = context.stateTypes.get(handler.stateName)
  if (!stateName || !targetType) return []
  const expressionAliases = new Map(aliases)
  const functional = handler.mode === 'functional'
  if (functional) expressionAliases.set('prev', '__opPrevious')
  const expression = scriptExpression(handler.ast, context.refNames, expressionAliases)
  const assignment = emitVueStateAssignment(
    stateName,
    expression,
    handler.ast,
    targetType,
    context,
    expressionAliases,
    functional
  )
  return [functional ? `{ const __opPrevious = ${stateName}.value; ${assignment} }` : assignment]
}
