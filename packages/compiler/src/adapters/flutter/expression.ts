import type { ExprAst } from '@open-pencil/core/lowcode-validation'

import { dartString } from './names'
import type { FlutterWarningSink } from './types'

export interface DartExpressionContext {
  names: ReadonlyMap<string, string>
  sourceId: string
  warn: FlutterWarningSink
}

export function emitDartExpression(ast: ExprAst, context: DartExpressionContext): string {
  switch (ast.kind) {
    case 'number':
      return Number.isFinite(ast.value) ? String(ast.value) : '0'
    case 'string':
      return dartString(ast.value)
    case 'ident':
      return resolveIdentifier(ast.name, context)
    case 'member':
      return `OpenPencilRuntime.member(${emitDartExpression(ast.object, context)}, ${dartString(ast.property)})`
    case 'unary': {
      const value = emitDartExpression(ast.arg, context)
      if (ast.op === '!') return `!OpenPencilRuntime.truthy(${value})`
      if (ast.op === '-') return `-OpenPencilRuntime.number(${value})`
      return `OpenPencilRuntime.number(${value})`
    }
    case 'binary':
      return emitBinary(ast.op, ast.left, ast.right, context)
    case 'ternary':
      return `OpenPencilRuntime.truthy(${emitDartExpression(ast.test, context)}) ? ${emitDartExpression(ast.consequent, context)} : ${emitDartExpression(ast.alternate, context)}`
    case 'template':
      return emitTemplate(ast.quasis, ast.expressions, context)
  }
  return 'null'
}

export function emitDartCondition(ast: ExprAst, context: DartExpressionContext): string {
  return `OpenPencilRuntime.truthy(${emitDartExpression(ast, context)})`
}

export function dartLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return dartString(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0'
  if (Array.isArray(value)) return `<dynamic>[${value.map(dartLiteral).join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, item]) => `${dartString(key)}: ${dartLiteral(item)}`)
    return `<String, dynamic>{${entries.join(', ')}}`
  }
  return 'null'
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function resolveIdentifier(name: string, context: DartExpressionContext): string {
  const resolved = context.names.get(name)
  if (resolved) return resolved
  context.warn({
    code: 'flutter-expression-identifier-unsupported',
    message: `Flutter static MVP replaced unresolved expression identifier ${JSON.stringify(name)} with null`,
    nodeId: context.sourceId
  })
  return 'null'
}

function emitBinary(
  operator: string,
  leftAst: ExprAst,
  rightAst: ExprAst,
  context: DartExpressionContext
): string {
  const left = emitDartExpression(leftAst, context)
  const right = emitDartExpression(rightAst, context)
  if (operator === '&&') return `OpenPencilRuntime.and(${left}, ${right})`
  if (operator === '||') return `OpenPencilRuntime.or(${left}, ${right})`
  if (operator === '+') return `OpenPencilRuntime.add(${left}, ${right})`
  if (operator === '===' || operator === '==') return `OpenPencilRuntime.equals(${left}, ${right})`
  if (operator === '!==' || operator === '!=') return `!OpenPencilRuntime.equals(${left}, ${right})`
  if (operator === '-' || operator === '*' || operator === '/' || operator === '%') {
    return `OpenPencilRuntime.arithmetic(${dartString(operator)}, ${left}, ${right})`
  }
  return `OpenPencilRuntime.compare(${dartString(operator)}, ${left}, ${right})`
}

function emitTemplate(
  quasis: readonly string[],
  expressions: readonly ExprAst[],
  context: DartExpressionContext
): string {
  const parts: string[] = []
  for (const [index, expression] of expressions.entries()) {
    if (quasis[index]) parts.push(dartString(quasis[index]))
    parts.push(`OpenPencilRuntime.text(${emitDartExpression(expression, context)})`)
  }
  const tail = quasis.at(-1)
  if (tail) parts.push(dartString(tail))
  return parts.length === 0 ? "''" : parts.join(' + ')
}
