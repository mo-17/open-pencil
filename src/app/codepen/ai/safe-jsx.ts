import { CODEPEN_AI_LIMITS } from './contracts'

const ALLOWED_TAGS = new Set(
  `Frame Text Rectangle Ellipse Line Star Polygon Vector Group Section View Rect
   Button Input Select Checkbox Form List Radio
   Textarea DatePicker Switch svg path g circle rect line polyline polygon ellipse`.split(/\s+/)
)

const ALLOWED_ATTRIBUTES = new Set(
  `name key flex flow dir gap wrap rowGap columnGap justify justifyContent items
   align alignItems grow w h width height minW maxW minH maxH x y top left
   position p padding px py pt pr pb pl bg fill fills background backgroundColor
   stroke border borderColor strokeWidth borderWidth strokeAlign strokeDash rounded
   borderRadius roundedTL roundedTR roundedBL roundedBR cornerRadius cornerSmoothing
   opacity blendMode rotate rotation overflow shadow blur effects size fontSize font
   fontFamily weight fontWeight color text characters content value title placeholder
   textColor placeholderColor checked disabled textAlign textAlignHorizontal
   textHorizontalAlignment textAlignVertical textVerticalAlignment textAutoResize
   lineHeight letterSpacing textDecoration textCase maxLines truncate grid columns rows
   colStart rowStart col row colSpan rowSpan points pointCount innerRadius label style
   viewBox d cx cy r rx ry x1 x2 y1 y2 stroke-width
   stroke-linecap stroke-linejoin fill-rule clip-rule`.split(/\s+/)
)

const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const UNSAFE_ATTRIBUTE_VALUE =
  /(?:\b(?:https?|data|javascript|file|blob):|(?:^|[\s"'(])\/\/|url\s*\(|@import\b|%3a|&colon;|&#0*58;|&#x0*3a;|(?:^|[\s"'(])(?:\/(?![/*])|\.\.?\/)[A-Za-z0-9])/i

export interface SafeJSXValidation {
  readonly elementCount: number
  readonly textNodeEstimate: number
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

class SafeLiteralParser {
  private index = 0
  private depth = 0

  constructor(private readonly source: string) {}

  parse(): void {
    this.skipSpace()
    this.readValue()
    this.skipSpace()
    if (this.index !== this.source.length) this.fail('unexpected trailing expression content')
  }

  private readValue(): void {
    this.depth++
    if (this.depth > 32) this.fail('literal nesting is too deep')
    this.skipSpace()
    const char = this.source[this.index] || ''
    if (char === '"' || char === "'") this.readString(char)
    else if (char === '[') this.readArray()
    else if (char === '{') this.readObject()
    else if (char === '-' || /[0-9]/.test(char)) this.readNumber()
    else this.readKeyword()
    this.depth--
  }

  private readString(quote: string): string {
    const start = ++this.index
    while (this.index < this.source.length) {
      const char = this.source[this.index]
      if (char === quote) {
        const value = this.source.slice(start, this.index)
        this.index++
        return value
      }
      if (char === '\\') this.fail('escape sequences are not allowed in literal strings')
      if (char === '\n' || char === '\r') this.fail('literal strings cannot contain raw newlines')
      this.index++
    }
    return this.fail('unterminated string')
  }

  private readNumber(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index))
    if (!match) this.fail('invalid number')
    const value = Number(match[0])
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
      this.fail('number must be finite and within the canvas bound')
    }
    this.index += match[0].length
  }

  private readArray(): void {
    this.index++
    this.skipSpace()
    if (this.take(']')) return
    for (;;) {
      this.readValue()
      this.skipSpace()
      if (this.take(']')) return
      if (!this.take(',')) this.fail('array values must be comma-separated')
      this.skipSpace()
      if (this.source[this.index] === ']') this.fail('trailing commas are not allowed')
    }
  }

  private readObject(): void {
    this.index++
    this.skipSpace()
    if (this.take('}')) return
    for (;;) {
      this.readObjectKey()
      this.skipSpace()
      if (!this.take(':')) this.fail('object keys must be followed by a colon')
      this.readValue()
      this.skipSpace()
      if (this.take('}')) return
      if (!this.take(',')) this.fail('object fields must be comma-separated')
      this.skipSpace()
      if (this.source[this.index] === '}') this.fail('trailing commas are not allowed')
    }
  }

  private readObjectKey(): void {
    const char = this.source[this.index]
    const key = char === '"' || char === "'" ? this.readString(char) : this.readIdentifier()
    if (RESERVED_OBJECT_KEYS.has(key)) this.fail('reserved object key')
  }

  private readIdentifier(): string {
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.source.slice(this.index))
    if (!match) this.fail('invalid object key')
    this.index += match[0].length
    return match[0]
  }

  private readKeyword(): void {
    if (this.takeKeyword('true') || this.takeKeyword('false') || this.takeKeyword('null')) return
    this.fail('only JSON-like literal expressions are allowed')
  }

  private takeKeyword(keyword: string): boolean {
    if (!this.source.startsWith(keyword, this.index)) return false
    const next = this.source[this.index + keyword.length]
    if (next && /[A-Za-z0-9_$]/.test(next)) return false
    this.index += keyword.length
    return true
  }

  private take(value: string): boolean {
    if (this.source[this.index] !== value) return false
    this.index++
    return true
  }

  private skipSpace(): void {
    while (/\s/.test(this.source[this.index] || '')) this.index++
  }

  private fail(reason: string): never {
    throw new TypeError(`Shadow draft JSX expression is unsafe: ${reason}`)
  }
}

class SafeJSXParser {
  private index = 0
  private elementCount = 0
  private textNodeEstimate = 0
  private readonly stack: string[] = []

  constructor(private readonly source: string) {}

  parse(): SafeJSXValidation {
    while (this.index < this.source.length) {
      if (this.source[this.index] === '<') this.readTag()
      else this.readText()
    }
    if (this.stack.length > 0) this.fail('tags are not balanced')
    return Object.freeze({
      elementCount: this.elementCount,
      textNodeEstimate: this.textNodeEstimate
    })
  }

  private readText(): void {
    const next = this.source.indexOf('<', this.index)
    const end = next === -1 ? this.source.length : next
    const text = this.source.slice(this.index, end)
    if (this.stack.length === 0 && text.trim()) {
      this.fail('executable content outside elements is not allowed')
    }
    if (text.includes('{') || text.includes('}')) {
      this.fail('expressions in text content are not allowed')
    }
    if (text.trim()) this.textNodeEstimate++
    this.index = end
  }

  private readTag(): void {
    this.index++
    const marker = this.source[this.index]
    if (marker === '!' || marker === '?') this.fail('comments and declarations are not allowed')
    const closing = marker === '/'
    if (closing) this.index++
    const tag = this.readName(/^[A-Za-z][A-Za-z0-9-]*/, 'tag')
    if (!ALLOWED_TAGS.has(tag)) this.fail(`tag is not allowed: ${tag}`)
    if (closing) this.readClosingTag(tag)
    else this.readOpeningTag(tag)
  }

  private readClosingTag(tag: string): void {
    this.skipSpace()
    if (!this.take('>')) this.fail('closing tag is malformed')
    if (this.stack.pop() !== tag) this.fail('tags are not balanced')
  }

  private readOpeningTag(tag: string): void {
    this.elementCount++
    if (this.elementCount > CODEPEN_AI_LIMITS.maxJSXElements) {
      throw new RangeError(`Shadow draft JSX exceeds ${CODEPEN_AI_LIMITS.maxJSXElements} elements`)
    }
    const attributes = new Set<string>()
    for (;;) {
      this.skipSpace()
      if (this.takeSequence('/>')) return
      if (this.take('>')) break
      const attribute = this.readAttribute()
      if (attributes.has(attribute)) this.fail(`duplicate attribute is not allowed: ${attribute}`)
      attributes.add(attribute)
      if (attributes.size > CODEPEN_AI_LIMITS.maxAttributesPerElement) {
        throw new RangeError('Shadow draft JSX has too many attributes on one element')
      }
    }
    this.stack.push(tag)
    if (this.stack.length > CODEPEN_AI_LIMITS.maxJSXDepth) {
      throw new RangeError(
        `Shadow draft JSX exceeds ${CODEPEN_AI_LIMITS.maxJSXDepth} nesting levels`
      )
    }
  }

  private readAttribute(): string {
    const attribute = this.readName(/^[A-Za-z_:][A-Za-z0-9_:.-]*/, 'attribute')
    if (!ALLOWED_ATTRIBUTES.has(attribute)) this.fail(`attribute is not allowed: ${attribute}`)
    if (/^on/i.test(attribute) || attribute === 'dangerouslySetInnerHTML') {
      this.fail('event or raw HTML attributes are not allowed')
    }
    this.skipSpace()
    if (!this.take('=')) return attribute
    this.skipSpace()
    const marker = this.source[this.index]
    const value = marker === '"' || marker === "'" ? this.readQuoted(marker) : this.readExpression()
    if (UNSAFE_ATTRIBUTE_VALUE.test(value)) {
      this.fail('external resource or network values are not allowed')
    }
    return attribute
  }

  private readQuoted(quote: string): string {
    const start = ++this.index
    const end = this.source.indexOf(quote, start)
    if (end === -1) this.fail('string attribute is unterminated')
    const value = this.source.slice(start, end)
    if (value.includes('\n') || value.includes('\r')) {
      this.fail('string attributes cannot contain raw newlines')
    }
    this.index = end + 1
    return value
  }

  private readExpression(): string {
    if (!this.take('{')) this.fail('attribute values must be quoted or literal')
    const start = this.index
    const closers = ['}']
    let quote = ''
    while (this.index < this.source.length && closers.length > 0) {
      const char = this.source[this.index]
      if (quote) quote = this.nextExpressionQuote(char, quote)
      else if (char === '"' || char === "'") quote = char
      else this.updateExpressionClosers(char, closers)
      this.index++
    }
    if (quote || closers.length > 0) this.fail('literal expression is unterminated')
    const expression = this.source.slice(start, this.index - 1)
    new SafeLiteralParser(expression).parse()
    return expression
  }

  private nextExpressionQuote(char: string, quote: string): string {
    if (char === '\\') this.fail('escape sequences are not allowed in literal expressions')
    if (char === '\n' || char === '\r') this.fail('literal strings cannot contain raw newlines')
    return char === quote ? '' : quote
  }

  private updateExpressionClosers(char: string, closers: string[]): void {
    if (char === '{') closers.push('}')
    else if (char === '[') closers.push(']')
    else if (char === '}' || char === ']') {
      if (closers.pop() !== char) this.fail('literal expression brackets are not balanced')
    }
  }

  private readName(pattern: RegExp, kind: string): string {
    const match = pattern.exec(this.source.slice(this.index))
    if (!match) this.fail(`${kind} name is malformed`)
    this.index += match[0].length
    return match[0]
  }

  private skipSpace(): void {
    while (/\s/.test(this.source[this.index] || '')) this.index++
  }

  private take(value: string): boolean {
    if (this.source[this.index] !== value) return false
    this.index++
    return true
  }

  private takeSequence(value: string): boolean {
    if (!this.source.startsWith(value, this.index)) return false
    this.index += value.length
    return true
  }

  private fail(reason: string): never {
    throw new TypeError(`Shadow draft JSX is unsafe: ${reason}`)
  }
}

export function validateSafeCodePenShadowJSX(jsx: string): SafeJSXValidation {
  if (typeof jsx !== 'string' || jsx.trim().length === 0) {
    throw new TypeError('Shadow draft JSX must be non-empty text')
  }
  if (byteLength(jsx) > CODEPEN_AI_LIMITS.maxJSXBytes) {
    throw new RangeError(`Shadow draft JSX exceeds ${CODEPEN_AI_LIMITS.maxJSXBytes} bytes`)
  }
  return new SafeJSXParser(jsx).parse()
}
