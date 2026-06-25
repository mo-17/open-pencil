import type {
  IRAttrValue,
  IRControlledInput,
  IRElement,
  IREventHandler,
  IREventName,
  IRExpression,
  IRImage,
  IRLink,
  IRLucideIcon,
  IRNode,
  IROverlay,
  IRText,
  IRUpload
} from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/core/lowcode-validation'

import { VALIDATION_ERROR_CLASS } from '../lowcode/validation'
import type { UiKitAdapter } from '../ui-kit/types'
import { emitEventHandler, emitFormSubmitHandler } from './event'
import { setterName } from './state'

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
    const propAttrs = node.props.map((p) => ` ${p.name}="${escapeAttr(p.value)}"`).join('')
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

/** Emit a plain element node (the `kind === 'element'` tail of `emitElement`).
 *  Phase 4 §19: a validated field is wrapped in a fragment with a per-field
 *  error `<p>` — the inner element is built one level deeper so it nests under
 *  the `<>`. Split from the core builder to avoid re-wrapping on recursion. */
function emitTagElement(
  node: IRElement,
  indent: number,
  devMode: boolean,
  uiKit: UiKitAdapter | null
): string {
  if (node.validation) {
    const inner = emitTagElementCore(node, indent + 1, devMode, uiKit)
    return wrapValidatedField(inner, node.validation.key, indent)
  }
  return emitTagElementCore(node, indent, devMode, uiKit)
}

/** Phase 4 §19: wrap a validated field's emitted element in a fragment that
 *  also renders its current error message below it. */
function wrapValidatedField(inner: string, key: string, indent: number): string {
  const pad = '  '.repeat(indent)
  const errPad = '  '.repeat(indent + 1)
  const k = JSON.stringify(key)
  return [
    `${pad}<>`,
    inner,
    `${errPad}{__fieldErrors[${k}] && (`,
    `${errPad}  <p className="${VALIDATION_ERROR_CLASS}" role="alert">{__fieldErrors[${k}]}</p>`,
    `${errPad})}`,
    `${pad}</>`
  ].join('\n')
}

/** The `<tag attrs>children` / void / inline-single-child / UI-kit composed
 *  control forms. Split out to keep `emitElement` under the complexity gate and
 *  to let `emitTagElement` wrap a validated field without recursing. */
function emitTagElementCore(
  node: IRElement,
  indent: number,
  devMode: boolean,
  uiKit: UiKitAdapter | null
): string {
  const pad = '  '.repeat(indent)

  if (node.overlay) return emitOverlayElement(node, indent, devMode, uiKit)
  if (node.icon) return emitLucideIconElement(node, indent, devMode)

  // Phase 3 §15 Phase B: a marked form control (SELECT/CHECKBOX/SWITCH/RADIO)
  // may be emitted as a composed kit component (`<Select><SelectTrigger>…`),
  // owning its own event-API translation + markup. Null → plain-HTML fallback.
  const kitControl = tryEmitKitControl(node, indent, devMode, uiKit)
  if (kitControl !== null) return kitControl
  const kitDisplay = tryEmitKitDisplay(node, indent, devMode, uiKit)
  if (kitDisplay !== null) return kitDisplay

  const { attrsStr, tagName } = tagOpenParts(node, devMode, uiKit)
  const opening = attrsStr ? `<${tagName} ${attrsStr}` : `<${tagName}`

  // Vector-shape nodes carry their geometry as inline SVG via
  // dangerouslySetInnerHTML (React forbids combining it with children, so the
  // collect pass leaves `children` empty when `rawHtml` is set).
  if (node.rawHtml !== undefined) {
    return `${pad}${opening} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(node.rawHtml)} }} />`
  }

  if (node.tag === 'img' && node.image?.sources && node.image.sources.length > 0) {
    return emitPictureElement(opening, node.image, indent)
  }

  if (VOID_TAGS.has(node.tag) || node.children.length === 0) {
    return `${pad}${opening} />`
  }

  // Inline single-child text/expression for compactness: <p>{count}</p>.
  const inlined = tryInlineSingleChild(node.children, opening, pad, tagName)
  if (inlined !== undefined) return inlined

  const lines = [`${pad}${opening}>`]
  if (node.formValidationSummary && node.formValidationKeys) {
    lines.push(
      emitValidationSummary(node.formValidationKeys, node.formValidationSummary.title, indent + 1)
    )
  }
  for (const child of node.children) lines.push(emitElement(child, indent + 1, devMode, uiKit))
  lines.push(`${pad}</${tagName}>`)
  return lines.join('\n')
}

/** §19 follow-up: opt-in FORM-level aggregate over the same field errors used
 *  by the per-field messages. The individual fields remain the source of truth;
 *  this only improves submit-time scanability. */
function emitValidationSummary(keys: readonly string[], title: string, indent: number): string {
  const pad = '  '.repeat(indent)
  const innerPad = '  '.repeat(indent + 1)
  const itemPad = '  '.repeat(indent + 2)
  const ids = keys.map((k) => JSON.stringify(k)).join(', ')
  return [
    `${pad}{[${ids}].some((id) => __fieldErrors[id]) && (`,
    `${innerPad}<div className="${VALIDATION_ERROR_CLASS}" role="alert">`,
    `${itemPad}<p>${escapeJSXText(title)}</p>`,
    `${itemPad}<ul>`,
    `${itemPad}  {[${ids}].filter((id) => __fieldErrors[id]).map((id) => (`,
    `${itemPad}    <li key={id}>{__fieldErrors[id]}</li>`,
    `${itemPad}  ))}`,
    `${itemPad}</ul>`,
    `${innerPad}</div>`,
    `${pad})}`
  ].join('\n')
}

function tagOpenParts(
  node: IRElement,
  devMode: boolean,
  uiKit: UiKitAdapter | null
): { attrsStr: string; tagName: string } {
  const className = ensureCardClipClass(node)
  const baseAttrsStr = formatAttrs(
    className,
    node.attrs,
    node.events,
    devMode ? node.sourceId : undefined,
    node.controlled,
    node.upload,
    node.classNameProp,
    node.classNamePropFallback,
    node.validation?.key,
    node.formValidationKeys,
    node.image,
    node.link
  )
  const displayMapping = node.displayKind ? uiKit?.mapDisplay?.(node.displayKind) : undefined
  const attrsStr = displayMapping ? displayAttrs(baseAttrsStr, node) : baseAttrsStr
  return { attrsStr, tagName: kitTagName(node, uiKit, displayMapping) }
}

/**
 * Phase 4 §15.1 with §6 follow-up: card-like rounded FRAMEs should keep child
 * overflow clipped at compile/runtime even when node.clipsContent is not set.
 * Add overflow-hidden via IR-emitted className so UI-kit wrappers (`<Card>`) and
 * plain `<div>` frames both inherit the expected corner clipping.
 */
function ensureCardClipClass(node: IRElement): string {
  if (node.containerKind !== 'card') return node.className
  if (node.className.includes('overflow-hidden')) return node.className
  return joinClass(node.className, 'overflow-hidden')
}

function kitTagName(
  node: IRElement,
  uiKit: UiKitAdapter | null,
  displayMapping: ReturnType<NonNullable<UiKitAdapter['mapDisplay']>> | undefined
): string {
  // Phase 3 §15: an interactive tag may map to a UI-kit component (`<Button>`),
  // keeping the same attrs/children. The underlying tag still drives void-ness
  // (a mapped `<input>` stays self-closing as `<Input />`). Phase 4 §15.1: a
  // card-like container FRAME maps `<div>` → `<Card>` via `mapContainer`,
  // keeping its children inside (unlike a composed control, which owns its
  // markup). Explicit display primitives take precedence over container/tag
  // mapping; container mapping takes precedence over the tag mapping.
  return (
    displayMapping?.component ??
    (node.containerKind ? uiKit?.mapContainer?.(node.containerKind)?.component : undefined) ??
    uiKit?.mapTag(node.tag, node.attrs)?.component ??
    node.tag
  )
}

/** Phase 4 §23: emit a validated named lucide-react icon. It is a leaf SVG
 *  component, but className/events/dev ids still ride the authored node so it
 *  behaves like the other compiled primitives. */
function emitLucideIconElement(node: IRElement, indent: number, devMode: boolean): string {
  const icon = node.icon
  if (!icon) return emitTagElementCore(node, indent, devMode, null)
  const pad = '  '.repeat(indent)
  const attrsStr = formatAttrs(
    node.className,
    node.attrs,
    node.events,
    devMode ? node.sourceId : undefined,
    undefined,
    undefined,
    node.classNameProp,
    node.classNamePropFallback,
    undefined,
    undefined,
    undefined,
    undefined
  )
  const iconAttrs = lucideIconAttrParts(icon)
  const allAttrs = [attrsStr, ...iconAttrs].filter((part) => part !== '').join(' ')
  return allAttrs ? `${pad}<${icon.name} ${allAttrs} />` : `${pad}<${icon.name} />`
}

function lucideIconAttrParts(icon: IRLucideIcon): string[] {
  const parts: string[] = []
  if (icon.size !== undefined) parts.push(`size={${icon.size}}`)
  if (icon.color !== undefined) parts.push(`color="${escapeAttr(icon.color)}"`)
  if (icon.strokeWidth !== undefined) parts.push(`strokeWidth={${icon.strokeWidth}}`)
  if (icon.ariaLabel !== undefined) {
    parts.push(`role="img"`)
    parts.push(`aria-label="${escapeAttr(icon.ariaLabel)}"`)
  } else {
    parts.push(`aria-hidden="true"`)
  }
  return parts
}

const OVERLAY_SHELL_CLASS: Record<IROverlay['kind'], string> = {
  modal: 'fixed inset-0 z-50 flex items-center justify-center',
  drawer: 'fixed inset-0 z-50 flex justify-end',
  popover: 'fixed inset-0 z-50 flex items-center justify-center',
  tooltip: 'fixed inset-0 z-50 flex items-center justify-center pointer-events-none'
}

const OVERLAY_PANEL_CLASS: Record<IROverlay['kind'], string> = {
  modal: 'relative z-10',
  drawer: 'relative z-10 h-full',
  popover: 'relative z-10',
  tooltip: 'relative z-10 pointer-events-auto'
}

export const OVERLAY_RUNTIME_CLASSES: readonly string[] = [
  ...Object.values(OVERLAY_SHELL_CLASS).flatMap((s) => s.split(/\s+/)),
  ...Object.values(OVERLAY_PANEL_CLASS).flatMap((s) => s.split(/\s+/)),
  'absolute',
  'inset-0',
  'bg-black/50'
]

/** Phase 4 §21: render a FRAME overlay as a conditional fixed shell. The IR
 *  element is the panel; this wrapper supplies backdrop/positioning and keeps
 *  the normal element emitter responsible for the panel's attrs/children. */
function emitOverlayElement(
  node: IRElement,
  indent: number,
  devMode: boolean,
  uiKit: UiKitAdapter | null
): string {
  const overlay = node.overlay
  if (!overlay) return emitTagElementCore(node, indent, devMode, uiKit)
  const pad = '  '.repeat(indent)
  const shellPad = '  '.repeat(indent + 1)
  const backdropPad = '  '.repeat(indent + 2)
  const panel = emitTagElementCore(
    {
      ...node,
      overlay: undefined,
      className: joinClass(node.className, OVERLAY_PANEL_CLASS[overlay.kind])
    },
    indent + 2,
    devMode,
    uiKit
  )
  const backdrop = overlay.closeOnBackdrop
    ? `${backdropPad}<button type="button" aria-label="Close overlay" className="absolute inset-0 bg-black/50" onClick={() => setDocState(${JSON.stringify(overlay.openRef)}, false)} />`
    : `${backdropPad}<div aria-hidden="true" className="absolute inset-0 bg-black/50" />`
  return [
    `${pad}{${overlay.openRef} && (`,
    `${shellPad}<div className="${OVERLAY_SHELL_CLASS[overlay.kind]}" role="presentation">`,
    backdrop,
    panel,
    `${shellPad}</div>`,
    `${pad})}`
  ].join('\n')
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

function tryEmitKitDisplay(
  node: IRElement,
  indent: number,
  devMode: boolean,
  uiKit: UiKitAdapter | null
): string | null {
  if (!uiKit?.emitDisplay || !node.displayKind) return null
  return uiKit.emitDisplay(node, {
    indent,
    devMode,
    emitChild: (child, childIndent) => emitElement(child, childIndent, devMode, uiKit),
    escapeAttr
  })
}

function displayAttrs(attrsStr: string, node: IRElement): string {
  const parts: string[] = []
  if (attrsStr !== '') parts.push(attrsStr)
  if (node.display?.variant !== undefined)
    parts.push(`variant="${escapeAttr(node.display.variant)}"`)
  if (node.displayKind === 'progress' && node.display?.value !== undefined) {
    parts.push(`value={${node.display.value}}`)
  }
  return parts.join(' ')
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
  upload: IRUpload | undefined,
  classNameProp?: string,
  classNamePropFallback?: boolean,
  validationKey?: string,
  formValidationKeys?: readonly string[],
  image?: IRImage,
  link?: IRLink
): string {
  const parts: string[] = []
  const classAttr = classNameAttr(className, classNameProp, classNamePropFallback)
  if (classAttr) parts.push(classAttr)
  if (nodeId !== undefined) parts.push(`data-node-id="${escapeAttr(nodeId)}"`)
  for (const [key, value] of Object.entries(attrs)) {
    parts.push(formatAttr(key, value))
  }
  // §18: a file-upload INPUT emits `type="file"` + an onChange that uploads to
  // Supabase Storage and writes the public URL into a doc-state. It's
  // uncontrolled, so collect leaves `controlled` undefined here.
  if (upload) parts.push(...uploadAttrParts(upload))
  // §24.1: an image node emits `src` (literal URL or a bound expression) + alt.
  if (image) parts.push(...imageAttrParts(image))
  // §25: a linked element emits `<a href target rel>` attrs.
  if (link) parts.push(...linkAttrParts(link))
  if (controlled)
    parts.push(...controlledAttrParts(controlled, attrs, events?.onChange, validationKey))
  // §19: a validated field gets `aria-invalid` + an `onBlur` that validates it.
  if (validationKey !== undefined)
    parts.push(...validationFieldParts(validationKey, events?.onBlur))
  parts.push(
    ...eventAttrParts(events, formValidationKeys, {
      skip: eventSkipSet(controlled, validationKey)
    })
  )
  return parts.join(' ')
}

function classNameAttr(
  className: string,
  classNameProp: string | undefined,
  classNamePropFallback: boolean | undefined
): string | undefined {
  // Phase 3 §8 v3: a component-body child whose className is parameterized
  // emits `className={prop}`; otherwise the static class string. Phase 3 §8 v5:
  // inside a COMPONENT_SET variant subtree the prop spans variants with
  // different static defaults → `className={prop ?? "thisVariantsClasses"}`.
  if (classNameProp && classNamePropFallback) {
    return `className={${classNameProp} ?? "${escapeAttr(className)}"}`
  }
  if (classNameProp) return `className={${classNameProp}}`
  if (className) return `className="${escapeAttr(className)}"`
  return undefined
}

function eventSkipSet(
  controlled: IRControlledInput | undefined,
  validationKey: string | undefined
): ReadonlySet<IREventName> {
  const skip = new Set<IREventName>()
  if (controlled) skip.add('onChange')
  if (validationKey !== undefined) skip.add('onBlur')
  return skip
}

function controlledAttrParts(
  controlled: IRControlledInput,
  attrs: Record<string, IRAttrValue>,
  onChangeHandlers: IREventHandler[] | undefined,
  validationKey: string | undefined
): string[] {
  // §3.v4 dispatch:
  //  - type="radio" → per-option `checked={read === <opt>}`.
  //  - type="checkbox" + targetType=array → group/multi-select.
  //  - targetType=boolean → `checked={read}` + e.target.checked.
  //  - text-like → `value={read}` + e.target.value.
  if (attrs.type === 'radio') {
    return controlledOptionAttrParts(controlled, attrs, 'radio', onChangeHandlers, validationKey)
  }
  if (attrs.type === 'checkbox' && controlled.write.targetType === 'array') {
    return controlledOptionAttrParts(
      controlled,
      attrs,
      'checkbox-group',
      onChangeHandlers,
      validationKey
    )
  }
  if (controlled.write.targetType === 'boolean') {
    return [
      `checked={${controlled.read}}`,
      controlledOnChangeAttr(
        controlled,
        controlledEventValue(controlled.write.targetType),
        onChangeHandlers,
        validationKey
      )
    ]
  }
  return controlledValueAttrParts(controlled, attrs, onChangeHandlers, validationKey)
}

function controlledOptionAttrParts(
  controlled: IRControlledInput,
  attrs: Record<string, IRAttrValue>,
  mode: 'radio' | 'checkbox-group',
  onChangeHandlers: IREventHandler[] | undefined,
  validationKey: string | undefined
): string[] {
  const optValue = optionValueExpression(attrs.value)
  const checked =
    mode === 'radio'
      ? `${controlled.read} === ${optValue}`
      : `${controlled.read}.includes(${optValue})`
  const value =
    mode === 'radio'
      ? controlledEventValue(controlled.write.targetType)
      : `e.target.checked ? [...${controlled.read}, ${optValue}] : ${controlled.read}.filter((v) => v !== ${optValue})`
  return controlledCheckedParts(controlled, checked, value, onChangeHandlers, validationKey)
}

function controlledCheckedParts(
  controlled: IRControlledInput,
  checkedExpr: string,
  valueExpr: string,
  onChangeHandlers: IREventHandler[] | undefined,
  validationKey: string | undefined
): string[] {
  return [
    `checked={${checkedExpr}}`,
    controlledOnChangeAttr(controlled, valueExpr, onChangeHandlers, validationKey)
  ]
}

function optionValueExpression(value: IRAttrValue | undefined): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'object' && value.kind === 'exprAttr') return emitExpression(value.ast)
  return JSON.stringify('')
}

function controlledValueAttrParts(
  controlled: IRControlledInput,
  attrs: Record<string, IRAttrValue>,
  onChangeHandlers: IREventHandler[] | undefined,
  validationKey: string | undefined
): string[] {
  const parts: string[] = []
  if (controlled.write.targetType === 'number' && !('type' in attrs)) {
    parts.push('type="number"')
  }
  parts.push(`value={${controlled.read}}`)
  parts.push(
    controlledOnChangeAttr(
      controlled,
      controlledEventValue(controlled.write.targetType),
      onChangeHandlers,
      validationKey
    )
  )
  return parts
}

/** Phase 4 §19: a validated field's `aria-invalid` + validate-on-blur attrs. */
function validationFieldParts(key: string, handlers: IREventHandler[] | undefined): string[] {
  const k = JSON.stringify(key)
  const eventValue = '(e.target as HTMLInputElement).value'
  const validate = `await __validateFieldValue(${k}, ${eventValue}, true)`
  const onBlur =
    handlers && handlers.length > 0
      ? `onBlur={${emitEventHandler(handlers, { eventLocals: true, prelude: [validate], forceAsync: true })}}`
      : `onBlur={async (e) => { ${validate}; }}`
  return [`aria-invalid={__fieldErrors[${k}] != null}`, onBlur]
}

/** The event-handler attrs. Phase 4 §19: when `formValidationKeys` is set (a
 *  `<form>` with validated fields), the onSubmit is emitted last as a wrapped
 *  handler (preventDefault + validate-then-abort), even if the form had no user
 *  onSubmit. Other events pass through unchanged. */
function eventAttrParts(
  events: Partial<Record<IREventName, IREventHandler[]>> | undefined,
  formValidationKeys: readonly string[] | undefined,
  options: { skip?: ReadonlySet<IREventName> } = {}
): string[] {
  const parts: string[] = []
  if (events) {
    for (const [name, handlers] of Object.entries(events) as [IREventName, IREventHandler[]][]) {
      if (handlers.length === 0) continue
      if (options.skip?.has(name)) continue
      // The wrapped onSubmit is emitted below from the same handlers.
      if (name === 'onSubmit' && formValidationKeys) continue
      parts.push(`${name}={${emitEventHandler(handlers, eventHandlerOptions(name))}}`)
    }
  }
  if (formValidationKeys) {
    parts.push(`onSubmit={${emitFormSubmitHandler(events?.onSubmit ?? [], formValidationKeys)}}`)
  }
  return parts
}

function eventHandlerOptions(name: IREventName): { eventLocals?: boolean } {
  return name === 'onChange' || name === 'onFocus' || name === 'onBlur' ? { eventLocals: true } : {}
}

/** Phase 4 §24.1: the JSX attrs for an image node — `src` (a literal URL or a
 *  bound expression) + `alt`. object-fit / aspect-ratio ride `className`. */
function imageAttrParts(image: IRImage): string[] {
  const src =
    image.srcExpr !== undefined
      ? `src={${emitExpression(image.srcExpr)}}`
      : `src="${escapeAttr(image.srcLiteral ?? '')}"`
  const parts = [src, `alt="${escapeAttr(image.alt)}"`]
  if (image.loading !== undefined) parts.push(`loading="${image.loading}"`)
  return parts
}

function emitPictureElement(opening: string, image: IRImage, indent: number): string {
  const pad = '  '.repeat(indent)
  const sourcePad = '  '.repeat(indent + 1)
  const lines = [`${pad}<picture>`]
  for (const source of image.sources ?? []) {
    lines.push(`${sourcePad}<source ${sourceAttrParts(source).join(' ')} />`)
  }
  lines.push(`${sourcePad}${opening} />`)
  lines.push(`${pad}</picture>`)
  return lines.join('\n')
}

function sourceAttrParts(source: NonNullable<IRImage['sources']>[number]): string[] {
  const srcSet =
    source.srcExpr !== undefined
      ? `srcSet={${emitExpression(source.srcExpr)}}`
      : `srcSet="${escapeAttr(source.srcLiteral ?? '')}"`
  const parts = [srcSet]
  if (source.media !== undefined) parts.push(`media="${escapeAttr(source.media)}"`)
  if (source.type !== undefined) parts.push(`type="${escapeAttr(source.type)}"`)
  if (source.sizes !== undefined) parts.push(`sizes="${escapeAttr(source.sizes)}"`)
  return parts
}

/** Phase 4 §25: external link attrs. `_blank` gets a safe `rel`; other targets
 *  keep only `target` so internal browser semantics are not changed. */
function linkAttrParts(link: IRLink): string[] {
  const href =
    link.hrefExpr !== undefined
      ? `href={${emitExpression(link.hrefExpr)}}`
      : `href="${escapeAttr(link.hrefLiteral ?? '')}"`
  const parts = [href, `target="${link.target}"`]
  if (link.target === '_blank') parts.push('rel="noopener noreferrer"')
  return parts
}

/** Join two class strings, skipping empties (no leading/trailing space). */
function joinClass(base: string, extra: string): string {
  if (extra === '') return base
  return base === '' ? extra : `${base} ${extra}`
}

/** Phase 4 §18: the JSX attrs for a file-upload INPUT — `type="file"`, an
 *  optional `accept`, and the upload onChange. Split out to keep `formatAttrs`
 *  under the complexity gate. */
function uploadAttrParts(upload: IRUpload): string[] {
  const parts = ['type="file"']
  if (upload.accept) parts.push(`accept="${escapeAttr(upload.accept)}"`)
  parts.push(`onChange={${emitUploadHandler(upload)}}`)
  return parts
}

/** Phase 4 §18: the async onChange for a file-upload INPUT. Reads the chosen
 *  file, uploads it to `storage.from(bucket).upload(path, file, { upsert: true })`
 *  (path = `<pathExpr>/<filename>` when a prefix is set, else the bare file
 *  name), then writes the object's public URL into the result doc-state. A
 *  failed upload is left silent (no URL written). */
function emitUploadHandler(u: IRUpload): string {
  const bucket = JSON.stringify(u.bucket)
  const target = JSON.stringify(u.resultTarget)
  const path = u.pathAst ? '`${' + emitExpression(u.pathAst) + '}/${__file.name}`' : '__file.name'
  return (
    'async (e) => { ' +
    'const __file = e.target.files?.[0]; if (!__file) return; ' +
    `const __path = ${path}; ` +
    `const { error: __err } = await getSupabaseClient().storage.from(${bucket}).upload(__path, __file, { upsert: true }); ` +
    `if (!__err) setDocState(${target}, getSupabaseClient().storage.from(${bucket}).getPublicUrl(__path).data.publicUrl); ` +
    '}'
  )
}

/** Phase 3 §3.x: emit body for a controlled INPUT's onChange — calls the
 *  matching writer with `e.target.value` (string targets) or
 *  `Number(e.target.value)` (number targets). docState writes go through
 *  the lowcode runtime `setDocState('name', value)`; page-state writes go
 *  through the `useState` setter `setName(value)`. */
function controlledOnChangeAttr(
  c: IRControlledInput,
  valueExpr: string,
  handlers: IREventHandler[] | undefined,
  validationKey: string | undefined
): string {
  const write = controlledWriteCall(c, valueExpr)
  const prelude = [write]
  if (validationKey !== undefined) {
    prelude.push(`await __validateFieldValue(${JSON.stringify(validationKey)}, ${valueExpr})`)
  }
  if (!handlers || handlers.length === 0) {
    if (prelude.length === 1) return `onChange={(e) => ${write}}`
    return `onChange={${emitEventHandler([], { prelude, forceAsync: true })}}`
  }
  return `onChange={${emitEventHandler(handlers, { eventLocals: true, prelude, forceAsync: validationKey !== undefined })}}`
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

function formatAttr(key: string, value: IRAttrValue): string {
  if (typeof value === 'string') return `${key}="${escapeAttr(value)}"`
  if (typeof value === 'number') return `${key}={${value}}`
  // Phase 3 §9 v3: an i18n-externalized attribute (e.g. placeholder) →
  // `attr={intl.formatMessage({ id, defaultMessage })}`. The enclosing function
  // gets a `const intl = useIntl()` hook from the scaffold (driven by hasIntlAttr).
  if (typeof value === 'object') {
    if (value.kind === 'exprAttr') return `${key}={${emitExpression(value.ast)}}`
    if (value.kind === 'styleAttr') return `${key}={${formatStyleAttr(value.declarations)}}`
    return `${key}={intl.formatMessage({ id: "${value.messageId}", defaultMessage: ${JSON.stringify(value.defaultMessage)} })}`
  }
  return value ? key : `${key}={false}`
}

function formatStyleAttr(declarations: Record<string, string>): string {
  const entries = Object.entries(declarations)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prop, value]) => `${prop}: ${JSON.stringify(value)}`)
  return `{ ${entries.join(', ')} }`
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
