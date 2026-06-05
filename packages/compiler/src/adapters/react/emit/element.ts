import { emitExpression } from '@open-pencil/core/lowcode-validation'
import type {
  IRAttrValue,
  IRControlledInput,
  IRElement,
  IREventHandler,
  IREventName,
  IRExpression,
  IRNode,
  IRText
} from '#compiler/ir/types'

import { emitEventHandler } from './event'
import { setterName } from './state'
import type { UiKitAdapter } from '../ui-kit/types'

/** Tags that must self-close in JSX (no children). */
const VOID_TAGS: ReadonlySet<string> = new Set(['input', 'br', 'hr', 'img', 'meta', 'link'])

/**
 * IR → JSX source string. Pure, single-pass, no scene-graph access — the
 * adapter layer's contract.
 *
 * Indent is in two-space units, matching the surrounding `App.tsx` template.
 *
 * `devMode` toggles the canvas↔preview bridge hook: when true, every element
 * is tagged with `data-node-id="<sceneId>"` so the bridge runtime can map a
 * DOM click back to a SceneNode. Off for production / CLI export.
 *
 * Phase 3 §15: `uiKit`, when set, rewrites interactive element tags
 * (`<button>` → `<Button>` etc.) to the kit's component; the design classes
 * and event/controlled props pass straight through. Null → plain HTML tags.
 */
export function emitElement(
  node: IRNode,
  indent: number,
  devMode = false,
  uiKit: UiKitAdapter | null = null
): string {
  const pad = '  '.repeat(indent)

  if (node.kind === 'text') {
    return `${pad}${emitText(node)}`
  }

  if (node.kind === 'expression') {
    // Phase 3 §8 v5: a COMPONENT_SET variant text prop carries a per-variant
    // fallback → `{prop ?? "thisVariantsOwnText"}`.
    return `${pad}{${emitExpressionWithFallback(node)}}`
  }

  if (node.kind === 'conditional') {
    // Phase 2 §9: `{(<expr>) && (<consequent>)}`. Trailing parens around the
    // consequent let it span multiple lines without confusing the `&&`.
    const inner = emitElement(node.consequent, indent + 1, devMode, uiKit)
    return `${pad}{(${emitExpression(node.ast)}) && (\n${inner}\n${pad})}`
  }

  if (node.kind === 'componentRef') {
    // Phase 3 §8: `<Name className="..." />`. The shared subtree lives in the
    // emitted component file; the usage site supplies its own root classes.
    // Phase 3 §8 v2: text-only instances pass their overridden text as props.
    const classAttr = node.className ? ` className="${escapeAttr(node.className)}"` : ''
    const propAttrs = node.props
      .map((p) => ` ${p.name}="${escapeAttr(p.value)}"`)
      .join('')
    const idAttr = devMode ? ` data-node-id="${node.sourceId}"` : ''
    return `${pad}<${node.name}${classAttr}${propAttrs}${idAttr} />`
  }

  if (node.kind === 'list') {
    // Phase 2 §9: `{(<arr>).map((item, index) => (<template/>))}`. The
    // template inherits the adapter's data-node-id when devMode is on.
    // React needs `key=` on the iterated element; we inject it into the
    // template's first JSX opening tag so even an IRConditional template
    // ends up with the key on the inner element rather than the `&&`.
    const tpl = injectKey(emitElement(node.template, indent + 1, devMode, uiKit), node.indexName)
    return (
      `${pad}{(${node.arrayName}).map((${node.itemName}, ${node.indexName}) => (\n` +
      `${tpl}\n` +
      `${pad}))}`
    )
  }

  return emitTagElement(node, indent, devMode, uiKit)
}

/** Emit a plain element node (the `kind === 'element'` tail of `emitElement`):
 *  the UI-kit composed-control path, then the standard `<tag attrs>children` /
 *  void / inline-single-child forms. Split out to keep `emitElement` under the
 *  complexity gate. */
function emitTagElement(
  node: IRElement,
  indent: number,
  devMode: boolean,
  uiKit: UiKitAdapter | null
): string {
  const pad = '  '.repeat(indent)

  // Phase 3 §15 Phase B: a marked form control (SELECT/CHECKBOX/SWITCH/RADIO)
  // may be emitted as a composed kit component (`<Select><SelectTrigger>…`),
  // owning its own event-API translation + markup. Null → plain-HTML fallback.
  const kitControl = tryEmitKitControl(node, indent, devMode, uiKit)
  if (kitControl !== null) return kitControl

  const attrsStr = formatAttrs(
    node.className,
    node.attrs,
    node.events,
    devMode ? node.sourceId : undefined,
    node.controlled,
    node.classNameProp,
    node.classNamePropFallback
  )
  // Phase 3 §15: an interactive tag may map to a UI-kit component (`<Button>`),
  // keeping the same attrs/children. The underlying tag still drives void-ness
  // (a mapped `<input>` stays self-closing as `<Input />`).
  const tagName = uiKit?.mapTag(node.tag, node.attrs)?.component ?? node.tag
  const opening = attrsStr ? `<${tagName} ${attrsStr}` : `<${tagName}`

  // Vector-shape nodes carry their geometry as inline SVG via
  // dangerouslySetInnerHTML (React forbids combining it with children, so the
  // collect pass leaves `children` empty when `rawHtml` is set).
  if (node.rawHtml !== undefined) {
    return `${pad}${opening} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(node.rawHtml)} }} />`
  }

  if (VOID_TAGS.has(node.tag) || node.children.length === 0) {
    return `${pad}${opening} />`
  }

  // Inline single-child text/expression for compactness: <p>{count}</p>.
  const inlined = tryInlineSingleChild(node.children, opening, pad, tagName)
  if (inlined !== undefined) return inlined

  const lines = [`${pad}${opening}>`]
  for (const child of node.children) lines.push(emitElement(child, indent + 1, devMode, uiKit))
  lines.push(`${pad}</${tagName}>`)
  return lines.join('\n')
}

/** Phase 3 §15 Phase B — emit a marked form control as a composed UI-kit
 *  component, or null to fall back to the plain-HTML path. Extracted from
 *  `emitElement` to keep it under the complexity gate. */
function tryEmitKitControl(
  node: IRElement,
  indent: number,
  devMode: boolean,
  uiKit: UiKitAdapter | null
): string | null {
  if (!uiKit?.emitControl || !node.controlKind) return null
  return uiKit.emitControl(node, {
    indent,
    devMode,
    emitChild: (child, childIndent) => emitElement(child, childIndent, devMode, uiKit),
    escapeAttr
  })
}

/** Compact a single text/expression child onto the element's own line
 *  (`<p>{count}</p>`). Returns undefined when the children don't qualify, so
 *  the caller falls back to the multi-line form. Phase 3 §8 v5: an expression
 *  child keeps its per-variant `?? fallback`. */
function tryInlineSingleChild(
  children: IRNode[],
  opening: string,
  pad: string,
  tag: string
): string | undefined {
  if (children.length !== 1) return undefined
  const only = children[0]
  if (only.kind === 'text') {
    // §9: a translatable text always inlines (`<FormattedMessage/>` is one
    // tag); a plain literal inlines only when single-line.
    if (only.messageId !== undefined || !only.value.includes('\n')) {
      return `${pad}${opening}>${emitText(only)}</${tag}>`
    }
    return undefined
  }
  if (only.kind === 'expression') {
    return `${pad}${opening}>{${emitExpressionWithFallback(only)}}</${tag}>`
  }
  return undefined
}

/** Phase 3 §9 — render a text node: a `<FormattedMessage>` when i18n tagged it
 *  with a `messageId`, otherwise the escaped literal. `defaultMessage` uses the
 *  JS-expression form so newlines/quotes in the source string stay valid.
 *  §9 v4 — when the message carries interpolation `values`, append a
 *  `values={{ name: <expr> }}` prop so ICU placeholders resolve at runtime. */
function emitText(node: IRText): string {
  if (node.messageId !== undefined) {
    const valuesAttr =
      node.values && node.values.length > 0
        ? ` values={{ ${node.values.map((v) => `${v.name}: ${emitExpression(v.ast)}`).join(', ')} }}`
        : ''
    return `<FormattedMessage id="${node.messageId}" defaultMessage={${JSON.stringify(node.value)}}${valuesAttr} />`
  }
  return escapeJSXText(node.value)
}

/** Phase 3 §8 v5: an expression's JS source, with a `?? "literal"` tail when it
 *  carries a per-variant default (COMPONENT_SET text prop). */
function emitExpressionWithFallback(node: IRExpression): string {
  const expr = emitExpression(node.ast)
  return node.fallback !== undefined ? `${expr} ?? ${JSON.stringify(node.fallback)}` : expr
}

function formatAttrs(
  className: string,
  attrs: Record<string, IRAttrValue>,
  events: Partial<Record<IREventName, IREventHandler[]>> | undefined,
  nodeId: string | undefined,
  controlled: IRControlledInput | undefined,
  classNameProp?: string,
  classNamePropFallback?: boolean
): string {
  const parts: string[] = []
  // Phase 3 §8 v3: a component-body child whose className is parameterized
  // emits `className={prop}`; otherwise the static class string. Phase 3 §8 v5:
  // inside a COMPONENT_SET variant subtree the prop spans variants with
  // different static defaults → `className={prop ?? "thisVariantsClasses"}`.
  if (classNameProp && classNamePropFallback) {
    parts.push(`className={${classNameProp} ?? "${escapeAttr(className)}"}`)
  } else if (classNameProp) parts.push(`className={${classNameProp}}`)
  else if (className) parts.push(`className="${escapeAttr(className)}"`)
  if (nodeId !== undefined) parts.push(`data-node-id="${escapeAttr(nodeId)}"`)
  for (const [key, value] of Object.entries(attrs)) {
    parts.push(formatAttr(key, value))
  }
  if (controlled) {
    // §3.v4 dispatch:
    //  - type="radio" → per-option `checked={read === <opt>}` (the IR collect
    //    pass copies the parent's controlled descriptor onto each radio child
    //    so formatAttrs sees it at the leaf)
    //  - type="checkbox" + targetType=array → group/multi-select: per-option
    //    `checked={read.includes(<opt>)}` + onChange toggles `<opt>` in/out
    //    of the array (§3.v4 step 8 CHECKBOX group)
    //  - targetType=boolean (CHECKBOX single / SWITCH) → `checked={read}` +
    //    e.target.checked
    //  - text-like (string / number; INPUT/TEXTAREA/SELECT/DATEPICKER) →
    //    `value={read}` + e.target.value (number wraps in Number(...) + sets
    //    type="number" when not already set)
    if (attrs.type === 'radio') {
      const optValue = typeof attrs.value === 'string' ? attrs.value : ''
      parts.push(`checked={${controlled.read} === ${JSON.stringify(optValue)}}`)
      parts.push(`onChange={(e) => ${controlledOnChangeBody(controlled)}}`)
    } else if (attrs.type === 'checkbox' && controlled.write.targetType === 'array') {
      const optValue = typeof attrs.value === 'string' ? attrs.value : ''
      const literal = JSON.stringify(optValue)
      parts.push(`checked={${controlled.read}.includes(${literal})}`)
      parts.push(`onChange={(e) => ${arrayCheckboxOnChangeBody(controlled, literal)}}`)
    } else if (controlled.write.targetType === 'boolean') {
      parts.push(`checked={${controlled.read}}`)
      parts.push(`onChange={(e) => ${controlledOnChangeBody(controlled)}}`)
    } else {
      if (controlled.write.targetType === 'number' && !('type' in attrs)) {
        parts.push('type="number"')
      }
      parts.push(`value={${controlled.read}}`)
      parts.push(`onChange={(e) => ${controlledOnChangeBody(controlled)}}`)
    }
  }
  if (events) {
    for (const [name, handlers] of Object.entries(events) as [
      IREventName,
      IREventHandler[]
    ][]) {
      if (handlers.length === 0) continue
      parts.push(`${name}={${emitEventHandler(handlers)}}`)
    }
  }
  return parts.join(' ')
}

/** Phase 3 §3.x: emit body for a controlled INPUT's onChange — calls the
 *  matching writer with `e.target.value` (string targets) or
 *  `Number(e.target.value)` (number targets). docState writes go through
 *  the lowcode runtime `setDocState('name', value)`; page-state writes go
 *  through the `useState` setter `setName(value)`. */
function controlledOnChangeBody(c: IRControlledInput): string {
  // §3.v4: boolean writes the `checked` value of the event target; number
  // wraps `value` in Number(...); string passes value through unchanged.
  return controlledWriteCall(c, controlledEventValue(c.write.targetType))
}

/** Phase 3 §3.x / §15 Phase B — the writer call for a controlled input: a
 *  docState write goes through the runtime `setDocState('name', <value>)`, a
 *  page-state write through the `useState` setter `setName(<value>)`. Shared by
 *  the plain-HTML onChange emit (formatAttrs) and the UI-kit composed-control
 *  emit (shadcn `onValueChange`/`onCheckedChange`). */
export function controlledWriteCall(c: IRControlledInput, valueExpr: string): string {
  if (c.write.kind === 'docState') {
    return `setDocState(${JSON.stringify(c.write.name)}, ${valueExpr})`
  }
  return `${setterName(c.write.name)}(${valueExpr})`
}

function controlledEventValue(targetType: IRControlledInput['write']['targetType']): string {
  if (targetType === 'boolean') return 'e.target.checked'
  if (targetType === 'number') return 'Number(e.target.value)'
  return 'e.target.value'
}

/** §3.v4 step 8: CHECKBOX group writer body. Toggles `optLiteral` in or
 *  out of the bound array depending on `e.target.checked`. Uses spread +
 *  filter rather than mutation so React sees a fresh reference and
 *  re-renders. */
function arrayCheckboxOnChangeBody(c: IRControlledInput, optLiteral: string): string {
  const next = `e.target.checked ? [...${c.read}, ${optLiteral}] : ${c.read}.filter((v) => v !== ${optLiteral})`
  return controlledWriteCall(c, next)
}

function formatAttr(key: string, value: IRAttrValue): string {
  if (typeof value === 'string') return `${key}="${escapeAttr(value)}"`
  if (typeof value === 'number') return `${key}={${value}}`
  // Phase 3 §9 v3: an i18n-externalized attribute (e.g. placeholder) →
  // `attr={intl.formatMessage({ id, defaultMessage })}`. The enclosing function
  // gets a `const intl = useIntl()` hook from the scaffold (driven by hasIntlAttr).
  if (typeof value === 'object') {
    return `${key}={intl.formatMessage({ id: "${value.messageId}", defaultMessage: ${JSON.stringify(value.defaultMessage)} })}`
  }
  return value ? key : `${key}={false}`
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

const JSX_ENTITY: Record<string, string> = {
  '{': '&#123;',
  '}': '&#125;',
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;'
}

function escapeJSXText(text: string): string {
  return text.replace(/[{}<>&]/g, (c) => JSX_ENTITY[c])
}

/**
 * Phase 2 §9 LIST emit: insert `key={<expr>}` right after the tag name of the
 * first JSX opening element in `emitted`. Matches `<tag ` or `<tag>` or
 * `<tag/>`. No-ops if no JSX tag is found (e.g. the template emits to an
 * expression block only).
 */
function injectKey(emitted: string, indexExpr: string): string {
  return emitted.replace(/<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/, `<$1 key={${indexExpr}}`)
}
