import { parseExpressionAt, type Node } from 'acorn'

import { defineTool } from './schema'

type ASTNode = Node & Record<string, unknown>

interface MathFunctionSpec {
  minArgs: number
  maxArgs: number
  evaluate: (args: readonly number[]) => number
}

const MAX_TOOL_INPUT_LENGTH = 256 * 1_024
const MAX_EXPRESSION_LENGTH = 2_048
const MAX_BATCH_EXPRESSIONS = 64
const MAX_AST_DEPTH = 32
const MAX_AST_NODES = 256
const MAX_FUNCTION_ARGS = 32

const MATH_FUNCTIONS: Readonly<Record<string, MathFunctionSpec>> = Object.freeze({
  min: { minArgs: 1, maxArgs: MAX_FUNCTION_ARGS, evaluate: (args) => Math.min(...args) },
  max: { minArgs: 1, maxArgs: MAX_FUNCTION_ARGS, evaluate: (args) => Math.max(...args) },
  floor: { minArgs: 1, maxArgs: 1, evaluate: ([value]) => Math.floor(value) },
  ceil: { minArgs: 1, maxArgs: 1, evaluate: ([value]) => Math.ceil(value) },
  round: { minArgs: 1, maxArgs: 1, evaluate: ([value]) => Math.round(value) },
  abs: { minArgs: 1, maxArgs: 1, evaluate: ([value]) => Math.abs(value) },
  sqrt: { minArgs: 1, maxArgs: 1, evaluate: ([value]) => Math.sqrt(value) },
  pow: { minArgs: 2, maxArgs: 2, evaluate: ([base, exponent]) => base ** exponent }
})

function invalid(reason: string): never {
  throw new TypeError(`Calculator expression is invalid: ${reason}`)
}

function requireNode(value: unknown, field: string): ASTNode {
  if (value === null || typeof value !== 'object' || typeof (value as ASTNode).type !== 'string') {
    return invalid(`${field} is malformed`)
  }
  return value as ASTNode
}

function finite(value: number): number {
  if (!Number.isFinite(value)) return invalid(`produced ${String(value)}`)
  return value
}

class ArithmeticEvaluator {
  #depth = 0
  #nodes = 0

  evaluate(node: ASTNode): number {
    this.#depth++
    this.#nodes++
    if (this.#depth > MAX_AST_DEPTH) return invalid('nesting is too deep')
    if (this.#nodes > MAX_AST_NODES) return invalid('contains too many operations')
    try {
      switch (node.type) {
        case 'Literal':
          return this.#literal(node)
        case 'ParenthesizedExpression':
          return this.evaluate(requireNode(node.expression, 'parenthesized expression'))
        case 'UnaryExpression':
          return this.#unary(node)
        case 'BinaryExpression':
          return this.#binary(node)
        case 'CallExpression':
          return this.#call(node)
        default:
          return invalid(`expression type ${node.type} is not allowed`)
      }
    } finally {
      this.#depth--
    }
  }

  #literal(node: ASTNode): number {
    if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
      return invalid('only finite numeric literals are allowed')
    }
    return node.value
  }

  #unary(node: ASTNode): number {
    if (node.operator !== '+' && node.operator !== '-') {
      return invalid(`unary operator ${String(node.operator)} is not allowed`)
    }
    const value = this.evaluate(requireNode(node.argument, 'unary argument'))
    return finite(node.operator === '-' ? -value : value)
  }

  #binary(node: ASTNode): number {
    const left = this.evaluate(requireNode(node.left, 'left operand'))
    const right = this.evaluate(requireNode(node.right, 'right operand'))
    let result: number
    switch (node.operator) {
      case '+':
        result = left + right
        break
      case '-':
        result = left - right
        break
      case '*':
        result = left * right
        break
      case '/':
        result = left / right
        break
      case '%':
        result = left % right
        break
      case '**':
        result = left ** right
        break
      default:
        return invalid(`binary operator ${String(node.operator)} is not allowed`)
    }
    return finite(result)
  }

  #call(node: ASTNode): number {
    if (node.optional === true) return invalid('optional calls are not allowed')
    const callee = requireNode(node.callee, 'function name')
    if (callee.type !== 'Identifier' || typeof callee.name !== 'string') {
      return invalid('only approved math functions may be called')
    }
    if (!Object.hasOwn(MATH_FUNCTIONS, callee.name)) {
      return invalid(`function ${callee.name} is not allowed`)
    }
    if (!Array.isArray(node.arguments)) return invalid('function arguments are malformed')
    const spec = MATH_FUNCTIONS[callee.name]
    if (node.arguments.length < spec.minArgs || node.arguments.length > spec.maxArgs) {
      return invalid(
        `function ${callee.name} expects ${
          spec.minArgs === spec.maxArgs ? String(spec.minArgs) : `${spec.minArgs}-${spec.maxArgs}`
        } arguments`
      )
    }
    const args = node.arguments.map((argument) => {
      const child = requireNode(argument, 'function argument')
      if (child.type === 'SpreadElement') return invalid('spread arguments are not allowed')
      return this.evaluate(child)
    })
    return finite(spec.evaluate(args))
  }
}

function evaluateArithmeticExpression(source: string): number {
  if (source.trim() === '') return invalid('expression is empty')
  if (source.length > MAX_EXPRESSION_LENGTH) {
    return invalid(`expression exceeds ${MAX_EXPRESSION_LENGTH} characters`)
  }
  let node: ASTNode
  try {
    node = requireNode(
      parseExpressionAt(source, 0, { ecmaVersion: 'latest', preserveParens: true }),
      'expression'
    )
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error))
  }
  if (source.slice(0, node.start).trim() !== '' || source.slice(node.end).trim() !== '') {
    return invalid('only one expression is allowed')
  }
  return new ArithmeticEvaluator().evaluate(node)
}

function evalExpr(
  expr: string
): { expr: string; result: number } | { expr: string; error: string } {
  try {
    return { expr, result: evaluateArithmeticExpression(expr) }
  } catch (error) {
    return { expr, error: error instanceof Error ? error.message : String(error) }
  }
}

function expressionsFromInput(expr: string): string[] | { error: string } {
  if (expr.length > MAX_TOOL_INPUT_LENGTH) {
    return { error: `Calculator input exceeds ${MAX_TOOL_INPUT_LENGTH} characters` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(expr)
  } catch {
    return [expr]
  }
  if (!Array.isArray(parsed)) return [expr]
  if (parsed.length > MAX_BATCH_EXPRESSIONS) {
    return { error: `Calculator batch exceeds ${MAX_BATCH_EXPRESSIONS} expressions` }
  }
  if (!parsed.every((entry) => typeof entry === 'string')) {
    return { error: 'Calculator batch entries must all be strings' }
  }
  return parsed
}

export const calc = defineTool({
  name: 'calc',
  description:
    'Bounded arithmetic calculator. ALWAYS use instead of mental math. ' +
    'Pass one expression or a JSON array of expressions — all evaluated in one call. ' +
    'Supports: + - * / % ** ( ) min max floor ceil round abs sqrt pow. ' +
    'Examples: "844 - 56 - 96 - 82", \'["1440 * 8 / 12", "(952 - 16) / 2", "floor(390 * 0.6)"]\'',
  params: {
    expr: {
      type: 'string',
      description: 'Single expression or JSON array of expressions',
      required: true
    }
  },
  execute: (_figma, { expr }) => {
    const expressions = expressionsFromInput(expr)
    if ('error' in expressions) return expressions
    if (expressions.length === 1) return evalExpr(expressions[0])
    return { results: expressions.map(evalExpr) }
  }
})
