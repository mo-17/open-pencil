/**
 * Phase 0 expression sub-language.
 *
 * Grammar (precedence climbing, lowest → highest):
 *
 *   expr     := ternary
 *   ternary  := logicalOr ('?' expr ':' expr)?
 *   logOr    := logAnd ('||' logAnd)*
 *   logAnd   := equality ('&&' equality)*
 *   equality := compare (('==='|'!=='|'=='|'!=') compare)*
 *   compare  := additive (('<='|'>='|'<'|'>') additive)*
 *   additive := multiplicative (('+'|'-') multiplicative)*
 *   mul      := unary (('*'|'/'|'%') unary)*
 *   unary    := ('!'|'-'|'+') unary | primary
 *   primary  := number | string | ident ('.' ident)* | '(' expr ')'
 *
 * Notes:
 * - No function calls, no array/object literals, no assignment, no bitwise.
 * - No `eval` / `Function` — the AST is built by hand and re-emitted into a
 *   pure JS expression string.
 * - Identifiers are NOT resolved at parse time; callers (adapters) walk
 *   `result.references` to decide which state names are required in scope.
 */

export type ExprAst =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ident'; name: string }
  | { kind: 'member'; object: ExprAst; property: string }
  | { kind: 'unary'; op: '!' | '-' | '+'; arg: ExprAst }
  | { kind: 'binary'; op: BinaryOp; left: ExprAst; right: ExprAst }
  | { kind: 'ternary'; test: ExprAst; consequent: ExprAst; alternate: ExprAst }

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '===' | '!==' | '==' | '!='
  | '<' | '>' | '<=' | '>='
  | '&&' | '||'

export interface ParseSuccess {
  ok: true
  ast: ExprAst
  references: Set<string>
}

export interface ParseFailure {
  ok: false
  error: string
}

export type ParseResult = ParseSuccess | ParseFailure

type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'punc'; value: '(' | ')' | '?' | ':' | '.' | ',' }

// `$` is allowed in identifiers (standard JS rule). Phase 2 §2 introduces the
// reserved identifier `$prev` for functional setState / setVariable updates;
// callers (`hasPrevReference` / `substitutePrev`) decide whether a `$`-prefixed
// reference is contextually valid. Other `$<name>` parses fine here but is
// flagged at IR-collect / validate time as an unknown identifier.
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/
const NUM_RE = /^\d+(?:\.\d+)?/
// Longest-match-first so multi-char ops win over their prefixes.
const OPS = [
  '===', '!==',
  '==', '!=', '<=', '>=', '&&', '||',
  '<', '>', '+', '-', '*', '/', '%', '!'
]

const PUNC_CHARS: ReadonlySet<string> = new Set(['(', ')', '?', ':', '.', ','])
const WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r'])

function tokenize(src: string): Token[] | string {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (WHITESPACE.has(ch)) {
      i++
      continue
    }
    if (PUNC_CHARS.has(ch)) {
      tokens.push({ type: 'punc', value: ch as '(' | ')' | '?' | ':' | '.' | ',' })
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      const result = readString(src, i)
      if (typeof result === 'string') return result
      tokens.push({ type: 'string', value: result.value })
      i = result.next
      continue
    }
    if (tryReadNumber(src, i, tokens)) {
      i += tokens[tokens.length - 1].value.toString().length
      continue
    }
    if (tryReadIdent(src, i, tokens)) {
      i += (tokens[tokens.length - 1] as { value: string }).value.length
      continue
    }
    const op = matchOperator(src, i)
    if (op) {
      tokens.push({ type: 'op', value: op })
      i += op.length
      continue
    }
    return `unexpected character '${ch}' at ${i}`
  }
  return tokens
}

/** Read a quoted string literal. Returns `{ value, next }` or an error string. */
function readString(src: string, start: number): { value: string; next: number } | string {
  const quote = src[start]
  let j = start + 1
  let value = ''
  while (j < src.length && src[j] !== quote) {
    if (src[j] === '\\' && j + 1 < src.length) {
      const next = src[j + 1]
      if (next === 'n') value += '\n'
      else if (next === 't') value += '\t'
      else if (next === '\\' || next === quote) value += next
      else return `unsupported escape \\${next} at ${j}`
      j += 2
      continue
    }
    value += src[j]
    j++
  }
  if (j >= src.length) return `unterminated string starting at ${start}`
  return { value, next: j + 1 }
}

function tryReadNumber(src: string, i: number, tokens: Token[]): boolean {
  const m = NUM_RE.exec(src.slice(i))
  if (!m) return false
  tokens.push({ type: 'number', value: Number(m[0]) })
  return true
}

function tryReadIdent(src: string, i: number, tokens: Token[]): boolean {
  const m = IDENT_RE.exec(src.slice(i))
  if (!m) return false
  tokens.push({ type: 'ident', value: m[0] })
  return true
}

function matchOperator(src: string, i: number): string | null {
  for (const op of OPS) {
    if (src.startsWith(op, i)) return op
  }
  return null
}

class Parser {
  pos = 0
  constructor(readonly tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  eat(): Token {
    if (this.pos >= this.tokens.length) {
      throw new SyntaxError('unexpected end of expression')
    }
    const t = this.tokens[this.pos]
    this.pos++
    return t
  }

  matchOp(...ops: string[]): string | null {
    const t = this.peek()
    if (t?.type === 'op' && ops.includes(t.value)) {
      this.pos++
      return t.value
    }
    return null
  }

  matchDot(): boolean {
    const t = this.peek()
    if (t?.type === 'punc' && t.value === '.') {
      this.pos++
      return true
    }
    return false
  }

  expectPunc(value: string): void {
    const t = this.peek()
    if (t?.type === 'punc' && t.value === value) {
      this.pos++
      return
    }
    throw new SyntaxError(`expected '${value}'`)
  }

  parseExpr(): ExprAst {
    return this.parseTernary()
  }

  parseTernary(): ExprAst {
    const test = this.parseLogicalOr()
    const t = this.peek()
    if (t?.type === 'punc' && t.value === '?') {
      this.pos++
      const consequent = this.parseExpr()
      this.expectPunc(':')
      const alternate = this.parseExpr()
      return { kind: 'ternary', test, consequent, alternate }
    }
    return test
  }

  parseLogicalOr(): ExprAst {
    let left = this.parseLogicalAnd()
    while (this.matchOp('||')) {
      left = { kind: 'binary', op: '||', left, right: this.parseLogicalAnd() }
    }
    return left
  }

  parseLogicalAnd(): ExprAst {
    let left = this.parseEquality()
    while (this.matchOp('&&')) {
      left = { kind: 'binary', op: '&&', left, right: this.parseEquality() }
    }
    return left
  }

  parseEquality(): ExprAst {
    let left = this.parseCompare()
    let op: string | null
    while ((op = this.matchOp('===', '!==', '==', '!='))) {
      left = { kind: 'binary', op: op as BinaryOp, left, right: this.parseCompare() }
    }
    return left
  }

  parseCompare(): ExprAst {
    let left = this.parseAdditive()
    let op: string | null
    while ((op = this.matchOp('<=', '>=', '<', '>'))) {
      left = { kind: 'binary', op: op as BinaryOp, left, right: this.parseAdditive() }
    }
    return left
  }

  parseAdditive(): ExprAst {
    let left = this.parseMul()
    let op: string | null
    while ((op = this.matchOp('+', '-'))) {
      left = { kind: 'binary', op: op as BinaryOp, left, right: this.parseMul() }
    }
    return left
  }

  parseMul(): ExprAst {
    let left = this.parseUnary()
    let op: string | null
    while ((op = this.matchOp('*', '/', '%'))) {
      left = { kind: 'binary', op: op as BinaryOp, left, right: this.parseUnary() }
    }
    return left
  }

  parseUnary(): ExprAst {
    const op = this.matchOp('!', '-', '+')
    if (op) return { kind: 'unary', op: op as '!' | '-' | '+', arg: this.parseUnary() }
    return this.parsePrimary()
  }

  parsePrimary(): ExprAst {
    const t = this.eat()
    if (t.type === 'number') return { kind: 'number', value: t.value }
    if (t.type === 'string') return { kind: 'string', value: t.value }
    if (t.type === 'punc' && t.value === '(') {
      const inner = this.parseExpr()
      this.expectPunc(')')
      return inner
    }
    if (t.type === 'ident') {
      let node: ExprAst = { kind: 'ident', name: t.value }
      while (this.matchDot()) {
        const prop = this.eat()
        if (prop.type !== 'ident') throw new SyntaxError('expected identifier after .')
        node = { kind: 'member', object: node, property: prop.value }
      }
      return node
    }
    throw new SyntaxError(`unexpected token '${describeToken(t)}'`)
  }
}

function describeToken(t: Token): string {
  if (t.type === 'number') return String(t.value)
  if (t.type === 'string') return JSON.stringify(t.value)
  return t.value
}

/** Parse `src` and return either a typed AST + referenced identifiers, or a
 *  human-readable error. Whitespace-only input is rejected. */
export function parseExpression(src: string): ParseResult {
  const trimmed = src.trim()
  if (trimmed === '') return { ok: false, error: 'empty expression' }
  const tokens = tokenize(trimmed)
  if (typeof tokens === 'string') return { ok: false, error: tokens }
  if (tokens.length === 0) return { ok: false, error: 'empty expression' }
  const parser = new Parser(tokens)
  let ast: ExprAst
  try {
    ast = parser.parseExpr()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (parser.pos < tokens.length) {
    return { ok: false, error: `unexpected trailing input at token ${parser.pos}` }
  }
  return { ok: true, ast, references: collectReferences(ast) }
}

function collectReferences(ast: ExprAst, acc = new Set<string>()): Set<string> {
  switch (ast.kind) {
    case 'ident':
      acc.add(ast.name)
      return acc
    case 'member':
      collectReferences(ast.object, acc)
      return acc
    case 'unary':
      collectReferences(ast.arg, acc)
      return acc
    case 'binary':
      collectReferences(ast.left, acc)
      collectReferences(ast.right, acc)
      return acc
    case 'ternary':
      collectReferences(ast.test, acc)
      collectReferences(ast.consequent, acc)
      collectReferences(ast.alternate, acc)
      return acc
    default:
      return acc
  }
}

/** Render a validated AST back to a JS expression string. The output is a
 *  syntactic subset of JS — safe to splice into an emitted source file.
 *  Parens are inserted as needed to preserve the original grouping. */
export function emitExpression(ast: ExprAst): string {
  return emitWithPrec(ast, 0)
}

const BINARY_PREC: Record<BinaryOp, number> = {
  '||': 2,
  '&&': 3,
  '===': 4,
  '!==': 4,
  '==': 4,
  '!=': 4,
  '<': 5,
  '>': 5,
  '<=': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7
}

const TERNARY_PREC = 1
const UNARY_PREC = 8

function emitWithPrec(ast: ExprAst, parentPrec: number): string {
  switch (ast.kind) {
    case 'number':
      return String(ast.value)
    case 'string':
      return JSON.stringify(ast.value)
    case 'ident':
      return ast.name
    case 'member':
      return `${emitWithPrec(ast.object, UNARY_PREC)}.${ast.property}`
    case 'unary':
      return wrap(`${ast.op}${emitWithPrec(ast.arg, UNARY_PREC)}`, UNARY_PREC, parentPrec)
    case 'binary': {
      const prec = BINARY_PREC[ast.op]
      // Left-associative: left uses prec, right uses prec+1 to force parens on
      // right-side same-precedence ops where they would re-associate wrongly.
      const left = emitWithPrec(ast.left, prec)
      const right = emitWithPrec(ast.right, prec + 1)
      return wrap(`${left} ${ast.op} ${right}`, prec, parentPrec)
    }
    case 'ternary': {
      const test = emitWithPrec(ast.test, TERNARY_PREC + 1)
      const consequent = emitWithPrec(ast.consequent, 0)
      const alternate = emitWithPrec(ast.alternate, TERNARY_PREC)
      return wrap(`${test} ? ${consequent} : ${alternate}`, TERNARY_PREC, parentPrec)
    }
    default:
      return ''
  }
}

function wrap(src: string, ownPrec: number, parentPrec: number): string {
  return ownPrec < parentPrec ? `(${src})` : src
}

/**
 * Phase 2 §2: reserved identifier used inside SetStateAction / SetVariableAction
 * `valueExpr` to opt into a React functional updater (`setX(prev => …)`). Other
 * call sites (BindingExpr.expr, renderCondition) reject `$prev` at IR-collect /
 * validate time.
 */
export const PREV_IDENT = '$prev'

/** True if the AST references `$prev` anywhere. */
export function hasPrevReference(ast: ExprAst): boolean {
  switch (ast.kind) {
    case 'ident':
      return ast.name === PREV_IDENT
    case 'member':
      return hasPrevReference(ast.object)
    case 'unary':
      return hasPrevReference(ast.arg)
    case 'binary':
      return hasPrevReference(ast.left) || hasPrevReference(ast.right)
    case 'ternary':
      return (
        hasPrevReference(ast.test) ||
        hasPrevReference(ast.consequent) ||
        hasPrevReference(ast.alternate)
      )
    default:
      return false
  }
}

/**
 * Return a new AST with every `$prev` identifier renamed to `replacement` so
 * the emit step can splice the result into a functional-updater body
 * (`(prev) => <substituted-expr>`). The input AST is not mutated.
 */
export function substitutePrev(ast: ExprAst, replacement: string): ExprAst {
  switch (ast.kind) {
    case 'ident':
      return ast.name === PREV_IDENT ? { kind: 'ident', name: replacement } : ast
    case 'member':
      return { kind: 'member', object: substitutePrev(ast.object, replacement), property: ast.property }
    case 'unary':
      return { kind: 'unary', op: ast.op, arg: substitutePrev(ast.arg, replacement) }
    case 'binary':
      return {
        kind: 'binary',
        op: ast.op,
        left: substitutePrev(ast.left, replacement),
        right: substitutePrev(ast.right, replacement)
      }
    case 'ternary':
      return {
        kind: 'ternary',
        test: substitutePrev(ast.test, replacement),
        consequent: substitutePrev(ast.consequent, replacement),
        alternate: substitutePrev(ast.alternate, replacement)
      }
    default:
      return ast
  }
}
