/* eslint-disable max-lines -- one recursive WXML walk keeps tag pairing and warning policy auditable */
import type {
  ComponentDef,
  IRAttrValue,
  IRComponentRef,
  IRControlledInput,
  IRElement,
  IREventHandler,
  IRNode,
  IRStateDecl
} from '#compiler/ir/types'

import {
  emitMiniProgramCSSDeclarations,
  escapeMiniProgramMarkupAttribute,
  escapeMiniProgramMarkupText,
  escapeMiniProgramTemplateExpression,
  miniProgramElementTag,
  safeMiniProgramIdentifier,
  stableMiniProgramClassName,
  staticMiniProgramAttr,
  translateMiniProgramStyle,
  type MiniProgramAssetPlan,
  type MiniProgramPagePlan,
  type MiniProgramWarningSink
} from '../miniprogram-shared'
import { safeNativeStateDefault } from '../native-shared'
import {
  emitWechatControlledInputStatement,
  emitWechatEventStatements,
  type WechatEventContext
} from './event'
import { emitWechatTemplateExpression, type WechatExpressionScope } from './expression'

interface WechatPageEnvironment {
  assetPlan: MiniProgramAssetPlan
  components: ReadonlyMap<string, ComponentDef>
  page: MiniProgramPagePlan
  routeMap: ReadonlyMap<string, string>
  stateNames: ReadonlyMap<string, string>
  warn: MiniProgramWarningSink
}

interface WechatNodeEnvironment extends WechatPageEnvironment {
  builder: WechatPageBuilder
  componentStack: ReadonlySet<string>
  locals: ReadonlyMap<string, string>
  staticValues: ReadonlyMap<string, unknown>
}

interface WechatPageBuilder {
  methods: Map<string, string>
  methodNames: Set<string>
  styles: Map<string, Readonly<Record<string, string>>>
}

interface WechatPageEmission {
  wxml: string
  wxss: string
  js: string
}

const EVENT_BINDINGS: Readonly<Record<string, string>> = {
  onClick: 'bindtap',
  onChange: 'bindchange',
  onSubmit: 'bindsubmit',
  onFocus: 'bindfocus',
  onBlur: 'bindblur'
}

export function emitWechatPage(
  page: MiniProgramPagePlan,
  assetPlan: MiniProgramAssetPlan,
  components: ReadonlyMap<string, ComponentDef>,
  routeMap: ReadonlyMap<string, string>,
  warn: MiniProgramWarningSink
): WechatPageEmission {
  warnPageFeatures(page, warn)
  const statePlan = createStatePlan(page.ir.states, page.pageId, warn)
  const builder: WechatPageBuilder = {
    methods: new Map(),
    methodNames: new Set(),
    styles: new Map()
  }
  const environment: WechatNodeEnvironment = {
    assetPlan,
    builder,
    components,
    componentStack: new Set(),
    locals: new Map(),
    page,
    routeMap,
    stateNames: statePlan.names,
    staticValues: new Map(),
    warn
  }
  const body = page.ir.children.map((node) => emitWechatNode(node, 1, environment)).join('\n')
  return {
    wxml: `<view class="page-root">\n${body}\n</view>\n`,
    wxss: emitPageStyles(builder.styles),
    js: emitPageScript(statePlan.data, builder.methods)
  }
}

function emitWechatNode(node: IRNode, indent: number, environment: WechatNodeEnvironment): string {
  const pad = '  '.repeat(indent)
  if (node.kind === 'text') return `${pad}${escapeMiniProgramMarkupText(node.value)}`
  if (node.kind === 'expression') {
    const expression = emitWechatTemplateExpression(node.ast, expressionScope(environment))
    const fallback = node.fallback ? ` || ${JSON.stringify(node.fallback)}` : ''
    return `${pad}{{ ${escapeMiniProgramTemplateExpression(expression + fallback)} }}`
  }
  if (node.kind === 'conditional') {
    const condition = emitWechatTemplateExpression(node.ast, expressionScope(environment))
    const child = emitWechatNode(node.consequent, indent + 1, environment)
    return `${pad}<block wx:if="{{ ${escapeMiniProgramTemplateExpression(condition)} }}">\n${child}\n${pad}</block>`
  }
  if (node.kind === 'list') return emitWechatList(node, indent, environment)
  if (node.kind === 'componentRef') return emitWechatComponentRef(node, indent, environment)
  return emitWechatElement(node, indent, environment)
}

function emitWechatList(
  node: Extract<IRNode, { kind: 'list' }>,
  indent: number,
  environment: WechatNodeEnvironment
): string {
  const pad = '  '.repeat(indent)
  const arrayName = environment.stateNames.get(node.arrayName)
  if (!arrayName) {
    environment.warn({
      code: 'wechat-miniprogram-list-source-unavailable',
      message: 'WeChat Mini Program export omitted a list whose local array source is unavailable',
      nodeId: environment.page.pageId
    })
    return `${pad}<block />`
  }
  const itemName = safeMiniProgramIdentifier(node.itemName, 'item')
  const indexName = safeMiniProgramIdentifier(node.indexName, 'index')
  const locals = new Map(environment.locals)
  locals.set(node.itemName, itemName)
  locals.set(node.indexName, indexName)
  const child = emitWechatNode(node.template, indent + 1, { ...environment, locals })
  return `${pad}<block wx:for="{{ ${arrayName} }}" wx:key="*this" wx:for-item="${itemName}" wx:for-index="${indexName}">\n${child}\n${pad}</block>`
}

function emitWechatComponentRef(
  node: IRComponentRef,
  indent: number,
  environment: WechatNodeEnvironment
): string {
  const pad = '  '.repeat(indent)
  const definition = environment.components.get(node.name)
  if (!definition || environment.componentStack.has(node.name)) {
    environment.warn({
      code: 'wechat-miniprogram-component-reference-unsupported',
      message: 'WeChat Mini Program export omitted a missing or recursive component reference',
      nodeId: node.sourceId
    })
    return `${pad}<view${emitBoundaryAttributes(node, environment)} />`
  }
  if (node.motion || node.motionDrivers || node.prototypeBody || node.prototype) {
    environment.warn({
      code: 'wechat-miniprogram-component-runtime-unsupported',
      message:
        'WeChat Mini Program export emitted a static component fallback without Motion or prototype runtime',
      nodeId: node.sourceId
    })
  }
  const staticValues = componentValues(definition, node)
  const nodes = componentNodes(definition, staticValues, node.sourceId, environment.warn)
  const stack = new Set(environment.componentStack)
  stack.add(node.name)
  const childEnvironment = { ...environment, componentStack: stack, staticValues }
  const children = nodes
    .map((child) => emitWechatNode(child, indent + 1, childEnvironment))
    .join('\n')
  return `${pad}<view${emitBoundaryAttributes(node, environment)}>\n${children}\n${pad}</view>`
}

function emitWechatElement(
  node: IRElement,
  indent: number,
  environment: WechatNodeEnvironment
): string {
  const pad = '  '.repeat(indent)
  warnElementFeatures(node, environment.warn)
  const tag = miniProgramElementTag(node)
  const attributes = emitElementAttributes(node, tag, environment)
  if (node.rawHtml) return `${pad}<view${attributes} />`
  if (tag === 'image' || tag === 'input') return `${pad}<${tag}${attributes} />`
  const children = node.children
    .map((child) => emitWechatNode(child, indent + 1, environment))
    .join('\n')
  if (!children) return `${pad}<${tag}${attributes}></${tag}>`
  return `${pad}<${tag}${attributes}>\n${children}\n${pad}</${tag}>`
}

function emitElementAttributes(
  node: IRElement,
  tag: ReturnType<typeof miniProgramElementTag>,
  environment: WechatNodeEnvironment
): string {
  const attributes: string[] = []
  const styleClass = registerStyle(node, environment)
  if (styleClass) attributes.push(`class="${styleClass}"`)
  if (tag === 'image') {
    const source = resolveImageSource(node, environment)
    if (source) attributes.push(`src="${escapeMiniProgramMarkupAttribute(source)}"`)
    if (node.image?.alt) {
      attributes.push(`aria-label="${escapeMiniProgramMarkupAttribute(node.image.alt)}"`)
    }
    attributes.push(`mode="${imageMode(node.className)}"`)
    if (node.image?.loading === 'lazy') attributes.push('lazy-load="true"')
  }
  emitStaticAttributes(node.attrs, tag, attributes)
  emitControlledAttribute(node.controlled, node.sourceId, environment, attributes)
  attributes.push(
    ...emitEventAttributes(node.sourceId, node.events, node.controlled, tag, environment)
  )
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
}

function emitBoundaryAttributes(node: IRComponentRef, environment: WechatNodeEnvironment): string {
  const attributes: string[] = []
  const styleClass = registerClassStyle(node.sourceId, node.className, node.styleAttr, environment)
  if (styleClass) attributes.push(`class="${styleClass}"`)
  attributes.push(
    ...emitEventAttributes(node.sourceId, node.events, undefined, 'view', environment)
  )
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
}

function emitStaticAttributes(
  attrs: Readonly<Partial<Record<string, IRAttrValue>>>,
  tag: ReturnType<typeof miniProgramElementTag>,
  output: string[]
): void {
  const placeholder = staticMiniProgramAttr(attrs.placeholder)
  if ((tag === 'input' || tag === 'textarea') && placeholder) {
    output.push(`placeholder="${escapeMiniProgramMarkupAttribute(placeholder)}"`)
  }
  const name = staticMiniProgramAttr(attrs.name)
  if (name && (tag === 'input' || tag === 'textarea')) {
    output.push(`name="${escapeMiniProgramMarkupAttribute(name)}"`)
  }
  const maxLength = staticMiniProgramAttr(attrs.maxLength ?? attrs.maxlength)
  if ((tag === 'input' || tag === 'textarea') && /^\d{1,6}$/.test(maxLength ?? '')) {
    output.push(`maxlength="${maxLength}"`)
  }
  if (attrs.disabled === true) output.push('disabled="true"')
  if (attrs.checked === true && tag === 'input') output.push('checked="true"')
  if (tag === 'input') {
    const type = staticMiniProgramAttr(attrs.type)
    if (type && ['text', 'number', 'digit', 'password'].includes(type)) {
      output.push(`type="${type}"`)
    }
  }
}

function emitControlledAttribute(
  controlled: IRControlledInput | undefined,
  sourceId: string,
  environment: WechatNodeEnvironment,
  output: string[]
): void {
  if (!controlled) return
  const alias = environment.stateNames.get(controlled.read)
  if (!alias || controlled.write.kind !== 'state') {
    environment.warn({
      code: 'wechat-miniprogram-controlled-read-unsupported',
      message: 'WeChat Mini Program export omitted a controlled value outside local page state',
      nodeId: sourceId
    })
    return
  }
  const attribute = controlled.write.targetType === 'boolean' ? 'checked' : 'value'
  output.push(`${attribute}="{{ ${alias} }}"`)
}

function emitEventAttributes(
  sourceId: string,
  events: Partial<Record<string, IREventHandler[]>> | undefined,
  controlled: IRControlledInput | undefined,
  tag: string,
  environment: WechatNodeEnvironment
): string[] {
  const attributes: string[] = []
  const names = new Set([...Object.keys(events ?? {}), ...(controlled ? ['onChange'] : [])])
  for (const eventName of names) {
    const binding =
      eventName === 'onChange' && tag === 'input' ? 'bindinput' : EVENT_BINDINGS[eventName]
    if (!binding) continue
    const context: WechatEventContext = {
      expressionScope: expressionScope(environment),
      routeMap: environment.routeMap,
      sourceId,
      warn: environment.warn
    }
    const controlledStatement =
      controlled && eventName === 'onChange'
        ? emitWechatControlledInputStatement(controlled, context)
        : undefined
    const statements = [
      ...(controlledStatement ? [controlledStatement] : []),
      ...emitWechatEventStatements(events?.[eventName] ?? [], context)
    ]
    if (statements.length === 0) continue
    const methodName = allocateMethodName(sourceId, eventName, environment.builder)
    environment.builder.methods.set(methodName, emitMethod(methodName, statements))
    attributes.push(`${binding}="${methodName}"`)
  }
  return attributes
}

function allocateMethodName(
  sourceId: string,
  eventName: string,
  builder: WechatPageBuilder
): string {
  const suffix = stableMiniProgramClassName(`${sourceId}:${eventName}`).slice(3)
  const base = safeMiniProgramIdentifier(`${eventName}_${suffix}`, 'onEvent')
  let candidate = base
  let sequence = 2
  while (builder.methodNames.has(candidate)) candidate = `${base}_${sequence++}`
  builder.methodNames.add(candidate)
  return candidate
}

function emitMethod(name: string, statements: readonly string[]): string {
  return `  ${name}(event) {\n    ${statements.join('\n    ')}\n  }`
}

function registerStyle(node: IRElement, environment: WechatNodeEnvironment): string | undefined {
  const classOverride = node.classNameProp
    ? environment.staticValues.get(node.classNameProp)
    : undefined
  const className = typeof classOverride === 'string' ? classOverride : node.className
  const styleOverride = node.styleProp ? environment.staticValues.get(node.styleProp) : undefined
  const styleAttr = resolveStyleAttr(styleOverride, node.attrs.style)
  return registerClassStyle(node.sourceId, className, styleAttr, environment)
}

function resolveStyleAttr(
  override: unknown,
  fallback: IRAttrValue | undefined
): Extract<IRAttrValue, { kind: 'styleAttr' }> | undefined {
  if (override && typeof override === 'object' && !Array.isArray(override)) {
    return { kind: 'styleAttr', declarations: override as Record<string, string> }
  }
  if (fallback && typeof fallback === 'object' && fallback.kind === 'styleAttr') return fallback
  return undefined
}

function registerClassStyle(
  sourceId: string,
  className: string,
  styleAttr: Extract<IRAttrValue, { kind: 'styleAttr' }> | undefined,
  environment: WechatNodeEnvironment
): string | undefined {
  const result = translateMiniProgramStyle(className, styleAttr)
  const declarations: Record<string, string> = { ...result.declarations }
  if (result.unsupportedUtilities.length > 0) {
    environment.warn({
      code: 'wechat-miniprogram-style-unsupported',
      message: `WeChat Mini Program export omitted ${result.unsupportedUtilities.length} unsupported or unsafe style declaration(s)`,
      nodeId: sourceId
    })
  }
  if (result.backgroundAsset) {
    const path = environment.assetPlan.resolve(result.backgroundAsset)
    if (path) declarations['background-image'] = `url("/${path}")`
    else {
      environment.warn({
        code: 'wechat-miniprogram-image-background-unavailable',
        message: 'WeChat Mini Program export omitted an unavailable local background image',
        nodeId: sourceId
      })
    }
  }
  if (Object.keys(declarations).length === 0) return undefined
  const styleClass = stableMiniProgramClassName(sourceId)
  environment.builder.styles.set(styleClass, declarations)
  return styleClass
}

function resolveImageSource(
  node: IRElement,
  environment: WechatNodeEnvironment
): string | undefined {
  if (node.image?.srcExpr) {
    environment.warn({
      code: 'wechat-miniprogram-dynamic-image-unsupported',
      message: 'WeChat Mini Program export omitted a dynamic image source',
      nodeId: node.sourceId
    })
    return undefined
  }
  if ((node.image?.sources?.length ?? 0) > 0) {
    environment.warn({
      code: 'wechat-miniprogram-responsive-image-unsupported',
      message: 'WeChat Mini Program export omitted responsive image source variants',
      nodeId: node.sourceId
    })
  }
  const source = node.image?.srcLiteral ?? staticMiniProgramAttr(node.attrs.src)
  if (!source) return undefined
  const resolved = environment.assetPlan.resolve(source)
  if (resolved) return `/${resolved}`
  environment.warn({
    code: 'wechat-miniprogram-image-source-unsupported',
    message: 'WeChat Mini Program export omitted a remote, unsafe, or unavailable image source',
    nodeId: node.sourceId
  })
  return undefined
}

function imageMode(className: string): 'aspectFill' | 'aspectFit' | 'scaleToFill' {
  if (/\bobject-contain\b/.test(className)) return 'aspectFit'
  if (/\bobject-fill\b/.test(className)) return 'scaleToFill'
  return 'aspectFill'
}

function componentValues(
  definition: ComponentDef,
  reference: IRComponentRef
): ReadonlyMap<string, unknown> {
  const values = new Map<string, unknown>()
  for (const prop of definition.props) values.set(prop.name, prop.defaultValue)
  for (const axis of definition.variantAxes ?? []) values.set(axis.name, axis.defaultValue)
  for (const prop of reference.props) values.set(prop.name, prop.value)
  return values
}

function componentNodes(
  definition: ComponentDef,
  values: ReadonlyMap<string, unknown>,
  sourceId: string,
  warn: MiniProgramWarningSink
): readonly IRNode[] {
  if (!definition.variants) return definition.children
  const key = (definition.variantAxes ?? []).map((axis) => values.get(axis.name)).join('|')
  const variant = definition.variants.find((candidate) => candidate.key === key)
  if (variant) return variant.children
  warn({
    code: 'wechat-miniprogram-component-variant-unavailable',
    message:
      'WeChat Mini Program export used the default subtree for an unavailable component variant',
    nodeId: sourceId
  })
  return definition.variants[0]?.children ?? []
}

function expressionScope(environment: WechatNodeEnvironment): WechatExpressionScope {
  return {
    names: environment.stateNames,
    locals: environment.locals,
    staticValues: environment.staticValues
  }
}

function createStatePlan(
  states: readonly IRStateDecl[],
  pageId: string,
  warn: MiniProgramWarningSink
): { names: ReadonlyMap<string, string>; data: Readonly<Record<string, unknown>> } {
  const names = new Map<string, string>()
  const data: Record<string, unknown> = { __query: {}, __routeParams: {} }
  const used = new Set(Object.keys(data))
  for (const state of states) {
    const base = safeMiniProgramIdentifier(state.name, 'state')
    let alias = base
    let sequence = 2
    while (used.has(alias)) alias = `${base}_${sequence++}`
    used.add(alias)
    names.set(state.name, alias)
    data[alias] = safeDataValue(safeNativeStateDefault(state))
    if (alias !== state.name) {
      warn({
        code: 'wechat-miniprogram-state-name-sanitized',
        message:
          'WeChat Mini Program export mapped an unsafe or colliding state name to a generated identifier',
        nodeId: pageId
      })
    }
    if (state.computed || state.computedExpr || state.persist) {
      warn({
        code: 'wechat-miniprogram-state-runtime-unsupported',
        message:
          'WeChat Mini Program export emitted a static default for computed or persisted page state',
        nodeId: pageId
      })
    }
  }
  return { names, data }
}

function safeDataValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (depth >= 8) return null
  if (Array.isArray(value))
    return value.slice(0, 256).map((entry) => safeDataValue(entry, depth + 1))
  if (!value || typeof value !== 'object') return null
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 256)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    output[key] = safeDataValue(entry, depth + 1)
  }
  return output
}

function emitPageStyles(styles: ReadonlyMap<string, Readonly<Record<string, string>>>): string {
  const rules = [...styles]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([className, declarations]) =>
        `.${className} { ${emitMiniProgramCSSDeclarations(declarations)} }`
    )
  return ['.page-root { min-height: 100vh; position: relative; }', ...rules, ''].join('\n')
}

function emitPageScript(
  data: Readonly<Record<string, unknown>>,
  methods: ReadonlyMap<string, string>
): string {
  const methodSource = [...methods.values()].join(',\n')
  return `Page({
  data: ${JSON.stringify(data, null, 2)},
  onLoad(options) {
    const routeInput = options && typeof options === 'object' ? options : {}
    this.setData({ __query: routeInput, __routeParams: routeInput })
  }${methodSource ? `,\n${methodSource}` : ''}
})
`
}

function warnPageFeatures(page: MiniProgramPagePlan, warn: MiniProgramWarningSink): void {
  const ir = page.ir
  if (hasPageMotionRuntime(page)) {
    warn({
      code: 'wechat-miniprogram-motion-unsupported',
      message: 'WeChat Mini Program export emitted the page without Motion or prototype runtime',
      nodeId: page.pageId
    })
  }
  if (hasDynamicPageRoute(page)) {
    warn({
      code: 'wechat-miniprogram-dynamic-route-unsupported',
      message: 'WeChat Mini Program export emitted a static page route for a dynamic route pattern',
      nodeId: page.pageId
    })
  }
  if (ir.requiresAuth) {
    warn({
      code: 'wechat-miniprogram-auth-guard-unsupported',
      message: 'WeChat Mini Program export omitted an application authentication guard',
      nodeId: page.pageId
    })
  }
  if (hasDocumentStateRuntime(page)) {
    warn({
      code: 'wechat-miniprogram-document-state-unsupported',
      message: 'WeChat Mini Program export omitted shared document-state runtime',
      nodeId: page.pageId
    })
  }
  if (hasNetworkRuntime(page)) {
    warn({
      code: 'wechat-miniprogram-network-runtime-unsupported',
      message:
        'WeChat Mini Program export omitted server, analytics, and credential-backed runtime configuration',
      nodeId: page.pageId
    })
  }
}

function hasPageMotionRuntime(page: MiniProgramPagePlan): boolean {
  const ir = page.ir
  return Boolean(
    ir.motion || ir.motionDrivers || ir.motionScene || ir.prototype || ir.transitionKey
  )
}

function hasDynamicPageRoute(page: MiniProgramPagePlan): boolean {
  return Boolean(page.ir.routePattern?.includes(':') || page.ir.usesRouteParams)
}

function hasDocumentStateRuntime(page: MiniProgramPagePlan): boolean {
  const ir = page.ir
  return ir.docStateReads.length > 0 || ir.docStateWrites.length > 0 || ir.docStates.length > 0
}

function hasNetworkRuntime(page: MiniProgramPagePlan): boolean {
  const ir = page.ir
  return Boolean(
    (ir.serverWorkflows?.length ?? 0) > 0 ||
    (ir.listQueries?.length ?? 0) > 0 ||
    ir.supabaseConfig ||
    ir.analyticsConfig
  )
}

function warnElementFeatures(node: IRElement, warn: MiniProgramWarningSink): void {
  if (
    node.motion ||
    node.motionScene ||
    node.motionDrivers ||
    node.generatedEffect ||
    node.prototype
  ) {
    warn({
      code: 'wechat-miniprogram-node-motion-unsupported',
      message:
        'WeChat Mini Program export emitted a static node without Motion or prototype behavior',
      nodeId: node.sourceId
    })
  }
  if (node.rawHtml) {
    warn({
      code: 'wechat-miniprogram-raw-html-unsupported',
      message: 'WeChat Mini Program export omitted raw HTML or vector markup',
      nodeId: node.sourceId
    })
  }
  if (node.module || node.upload || node.overlay || node.link || node.icon) {
    warn({
      code: 'wechat-miniprogram-node-runtime-unsupported',
      message:
        'WeChat Mini Program export emitted a static fallback for a web or advanced runtime node',
      nodeId: node.sourceId
    })
  }
}
