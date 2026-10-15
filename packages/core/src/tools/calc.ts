import * as v from 'valibot'

import { CALC_FUNCTIONS, evaluateExpression } from './calc/expression'
import { defineTool } from './schema'

const MAX_TOOL_INPUT_LENGTH = 256 * 1_024
const MAX_BATCH_EXPRESSIONS = 64
const CALC_TOOL_LIMITS = {
  maxLength: 2048,
  maxDepth: 32,
  maxNodes: 256,
  maxFunctionArgs: 32,
  finiteOnly: true,
  allowRadixLiterals: true
}
function evalExpr(
  expr: string
): { expr: string; result: number } | { expr: string; error: string } {
  try {
    const result = evaluateExpression(expr, CALC_TOOL_LIMITS)
    if (!Number.isFinite(result)) {
      return { expr, error: `Produced ${String(result)}` }
    }
    return { expr, result }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      expr,
      error: message
    }
  }
}

function expressionsFromInput(expr: string): string[] | { expr?: string; error: string } {
  if (expr.length > MAX_TOOL_INPUT_LENGTH) {
    return {
      error: `Calculator input exceeds ${MAX_TOOL_INPUT_LENGTH} characters`
    }
  }
  const result = v.safeParse(v.pipe(v.string(), v.parseJson(), v.unknown()), expr)
  if (!result.success) return [expr]
  const parsed = result.output
  if (!Array.isArray(parsed)) return [expr]
  if (parsed.length > MAX_BATCH_EXPRESSIONS) {
    return {
      error: `Calculator batch exceeds ${MAX_BATCH_EXPRESSIONS} expressions`
    }
  }
  if (!parsed.every((entry) => typeof entry === 'string')) {
    return { expr, error: 'A JSON array of expressions must contain only strings' }
  }
  return parsed
}

export const calc = defineTool({
  name: 'calc',
  description:
    'Bounded arithmetic calculator. ALWAYS use instead of mental math. ' +
    'Pass one expression or a JSON array of expressions — all evaluated in one call. ' +
    `Supports: + - * / % ** ( ) ${CALC_FUNCTIONS.join(' ')}. ` +
    'Examples: "844 - 56 - 96 - 82", \'["1440 * 8 / 12", "(952 - 16) / 2", "floor(390 * 0.6)"]\'',
  execution: { kind: 'sync', mutation: 'none' },
  exposure: { webmcp: false },
  input: v.strictObject({
    expr: v.pipe(v.string(), v.description('Single expression or JSON array of expressions'))
  }),
  execute: (_figma, { expr }) => {
    const expressions = expressionsFromInput(expr)
    if ('error' in expressions) return expressions
    if (expressions.length === 1) return evalExpr(expressions[0])
    return { results: expressions.map(evalExpr) }
  }
})
