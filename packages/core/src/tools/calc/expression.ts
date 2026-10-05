import jsep from 'jsep'

/**
 * Arithmetic expression evaluator for the `calc` tool.
 *
 * `jsep` parses; this module walks the resulting syntax tree and evaluates
 * only the arithmetic the tool documents. Expressions arrive from a model, so
 * nothing is compiled into JavaScript and no host object is reachable: every
 * node type, operator and function is matched against an allowlist, and
 * anything else — identifiers, member access, arrays, conditionals, comparison
 * and logical operators — is rejected with a message naming what was used.
 */

const smaller = (left: number, right: number): number => Math.min(left, right)
const larger = (left: number, right: number): number => Math.max(left, right)

/** Functions the tool documents, with their accepted argument counts. */
const FUNCTIONS = {
  // Folded rather than spread: a long argument list overflows the call stack
  // on V8 at roughly 125k arguments, which an expression can reach.
  min: { arity: [1, Number.POSITIVE_INFINITY], apply: (args: number[]) => args.reduce(smaller) },
  max: { arity: [1, Number.POSITIVE_INFINITY], apply: (args: number[]) => args.reduce(larger) },
  floor: { arity: [1, 1], apply: ([value]: number[]) => Math.floor(value) },
  ceil: { arity: [1, 1], apply: ([value]: number[]) => Math.ceil(value) },
  round: { arity: [1, 1], apply: ([value]: number[]) => Math.round(value) },
  abs: { arity: [1, 1], apply: ([value]: number[]) => Math.abs(value) },
  sqrt: { arity: [1, 1], apply: ([value]: number[]) => Math.sqrt(value) },
  pow: { arity: [2, 2], apply: ([base, exponent]: number[]) => base ** exponent }
} as const satisfies Record<
  string,
  { arity: readonly [number, number]; apply: (args: number[]) => number }
>

export type CalcFunction = keyof typeof FUNCTIONS

export const CALC_FUNCTIONS = Object.keys(FUNCTIONS) as CalcFunction[]

const BINARY_OPERATORS = new Map<string, (left: number, right: number) => number>([
  ['+', (left, right) => left + right],
  ['-', (left, right) => left - right],
  ['*', (left, right) => left * right],
  ['/', (left, right) => left / right],
  ['%', (left, right) => left % right],
  ['**', (left, right) => left ** right]
])

const UNARY_OPERATORS = new Map<string, (value: number) => number>([
  ['-', (value) => -value],
  ['+', (value) => value]
])

export const CALC_OPERATORS = [...BINARY_OPERATORS.keys()]

/** Raised for input outside the supported arithmetic; the message reaches the caller. */
export class CalcSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalcSyntaxError'
  }
}

/** Human-readable name for a node the evaluator refuses, used in error messages. */
const UNSUPPORTED_NODES: Record<string, string> = {
  Identifier: 'a name',
  MemberExpression: 'property access',
  ArrayExpression: 'an array',
  Compound: 'more than one expression',
  ConditionalExpression: 'a conditional',
  ThisExpression: 'this'
}

function describeNode(node: jsep.Expression): string {
  return UNSUPPORTED_NODES[node.type] ?? `'${node.type}'`
}

function describeArity(minimum: number, maximum: number): string {
  if (minimum === maximum) return `${minimum} argument${minimum === 1 ? '' : 's'}`
  if (maximum === Number.POSITIVE_INFINITY) return `at least ${minimum} argument(s)`
  return `${minimum} to ${maximum} arguments`
}

function callFunction(node: jsep.CallExpression, limits?: CalcEvaluationLimits): number {
  const callee = node.callee
  if (callee.type !== 'Identifier') {
    throw new CalcSyntaxError(`Cannot call ${describeNode(callee)}`)
  }
  const name = (callee as jsep.Identifier).name
  // hasOwn, not `in`: inherited names such as `constructor` are not functions.
  if (!Object.hasOwn(FUNCTIONS, name)) {
    throw new CalcSyntaxError(`Unknown function '${name}'; supported: ${CALC_FUNCTIONS.join(', ')}`)
  }
  const args = node.arguments.map((argument) => evaluateNode(argument, limits))
  const { arity, apply } = FUNCTIONS[name as CalcFunction]
  const [minimum, maximum] = arity
  if (args.length < minimum || args.length > maximum) {
    throw new CalcSyntaxError(
      `'${name}' takes ${describeArity(minimum, maximum)}, received ${args.length}`
    )
  }
  return apply(args)
}

function evaluateNode(node: jsep.Expression, limits?: CalcEvaluationLimits): number {
  const result = evaluateUncheckedNode(node, limits)
  if (limits?.finiteOnly && !Number.isFinite(result))
    throw new CalcSyntaxError(`Produced ${String(result)}`)
  return result
}

function evaluateUncheckedNode(node: jsep.Expression, limits?: CalcEvaluationLimits): number {
  switch (node.type) {
    case 'Literal': {
      const { value, raw } = node as jsep.Literal
      if (typeof value !== 'number') {
        throw new CalcSyntaxError(`'${raw}' is not a number`)
      }
      return value
    }
    case 'UnaryExpression': {
      const { operator, argument } = node as jsep.UnaryExpression
      const apply = UNARY_OPERATORS.get(operator)
      if (!apply) throw new CalcSyntaxError(`Unsupported operator '${operator}'`)
      return apply(evaluateNode(argument, limits))
    }
    case 'BinaryExpression': {
      const { operator, left, right } = node as jsep.BinaryExpression
      const apply = BINARY_OPERATORS.get(operator)
      if (!apply) {
        throw new CalcSyntaxError(
          `Unsupported operator '${operator}'; supported: ${CALC_OPERATORS.join(' ')}`
        )
      }
      return apply(evaluateNode(left, limits), evaluateNode(right, limits))
    }
    case 'CallExpression':
      return callFunction(node as jsep.CallExpression, limits)
    default:
      throw new CalcSyntaxError(`Expression uses ${describeNode(node)}, which calc does not accept`)
  }
}

/**
 * Evaluate an arithmetic expression. Throws `CalcSyntaxError` for input the
 * parser rejects or the allowlist refuses; a well-formed expression may still
 * return a non-finite number, which the caller reports rather than this module.
 */
export function evaluateExpression(source: string, limits?: CalcEvaluationLimits): number {
  if (limits?.maxLength !== undefined && source.length > limits.maxLength)
    throw new CalcSyntaxError(`Expression exceeds ${limits.maxLength} characters`)
  if (source.trim() === '') throw new CalcSyntaxError('Expression is empty')
  // Parentheses collapse in jsep's AST, so count syntax nesting before parsing.
  if (limits?.maxDepth !== undefined) {
    let nesting = 0
    for (const character of source) {
      if (character === '(' && ++nesting > limits.maxDepth)
        throw new CalcSyntaxError('Expression nesting is too deep')
      if (character === ')') nesting--
    }
  }
  const normalized = limits?.allowRadixLiterals
    ? source.replace(/(?<![\w.])0(?:x[\da-f]+|b[01]+|o[0-7]+)(?![\w.])/gi, (literal) =>
        String(Number(literal))
      )
    : source
  let tree: jsep.Expression
  try {
    tree = jsep(normalized)
  } catch (error) {
    // jsep's own messages already name the offending character and position.
    throw new CalcSyntaxError(error instanceof Error ? error.message : String(error))
  }
  validateBudget(tree, limits)
  return evaluateNode(tree, limits)
}

export interface CalcEvaluationLimits {
  maxLength?: number
  maxDepth?: number
  maxNodes?: number
  maxFunctionArgs?: number
  finiteOnly?: boolean
  allowRadixLiterals?: boolean
}

function validateBudget(tree: jsep.Expression, limits?: CalcEvaluationLimits): void {
  if (!limits) return
  const pending: Array<[jsep.Expression, number]> = [[tree, 1]]
  let count = 0
  while (pending.length) {
    const item = pending.pop()
    if (!item) break
    const [node, depth] = item
    if (limits.maxDepth !== undefined && depth > limits.maxDepth)
      throw new CalcSyntaxError('Expression nesting is too deep')
    if (limits.maxNodes !== undefined && ++count > limits.maxNodes)
      throw new CalcSyntaxError('Expression contains too many operations')
    if (node.type === 'CallExpression') {
      const call = node as jsep.CallExpression
      if (limits.maxFunctionArgs !== undefined && call.arguments.length > limits.maxFunctionArgs)
        throw new CalcSyntaxError('Function has too many arguments')
      pending.push(
        ...call.arguments.map((argument): [jsep.Expression, number] => [argument, depth + 1])
      )
    } else if (node.type === 'BinaryExpression') {
      const binary = node as jsep.BinaryExpression
      pending.push([binary.left, depth + 1], [binary.right, depth + 1])
    } else if (node.type === 'UnaryExpression')
      pending.push([(node as jsep.UnaryExpression).argument, depth + 1])
  }
}
