import type {
  ComponentDef,
  IRElement,
  IREventHandler,
  IRNode,
  IRStateDecl,
  IRTree
} from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

import * as miniProgramShared from '../miniprogram-shared'
import { buildMpxPageConfig } from './project'
import type { MpxComponentPlan, MpxEnvironment } from './types'

const {
  emitMiniProgramCSSDeclarations,
  escapeMiniProgramMarkupAttribute,
  escapeMiniProgramMarkupText,
  escapeMiniProgramTemplateExpression,
  miniProgramEventFeature,
  miniProgramElementTag,
  safeMiniProgramIdentifier,
  stableMiniProgramClassName,
  staticMiniProgramAttr,
  translateMiniProgramStyle,
  warnMiniProgramPageFeatures,
  warnMiniProgramUnsupported
} = miniProgramShared

interface RegisteredMethod {
  body: string[]
  parameters: string[]
}

interface MpxTemplateContext extends MpxEnvironment {
  assetPrefix: string
  localNames: ReadonlySet<string>
  methods: Map<string, RegisteredMethod>
  styles: Map<string, string>
  usedComponents: Set<string>
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const MPX_STATIC_ATTRS = new Set(['disabled', 'maxlength', 'name', 'placeholder', 'readonly'])
const MPX_INPUT_TYPES = new Set(['text', 'number', 'password', 'digit', 'idcard', 'nickname'])

export function emitMpxPage(ir: IRTree, environment: MpxEnvironment): string {
  warnMiniProgramPageFeatures(ir, environment.warn, 'mpx', 'Mpx')
  const context = createTemplateContext(environment, '../../assets/')
  const template = ir.children.map((child) => renderNode(child, 2, context)).join('\n')
  const data = pageData(ir, environment)
  const script = pageScript(data, context.methods)
  const registrations: Record<string, string> = {}
  for (const name of context.usedComponents) {
    const component = environment.components.get(name)
    if (component) registrations[component.tag] = `../../components/${component.slug}`
  }
  return `<template>
  <view class="op-page">
${template}
  </view>
</template>

<script>
${script}
</script>

<script type="application/json">
${buildMpxPageConfig(ir.pageName, registrations)}
</script>

<style>
.op-page { box-sizing: border-box; min-height: 100vh; position: relative; }
${styleSheet(context.styles)}
</style>
`
}

export function emitMpxComponent(plan: MpxComponentPlan, environment: MpxEnvironment): string {
  warnDefinitionFeatures(plan.definition, environment)
  const context = createTemplateContext(environment, '../assets/')
  const nodes = plan.definition.variants?.[0]?.children ?? plan.definition.children
  const template = nodes.map((child) => renderNode(child, 2, context)).join('\n')
  const registrations: Record<string, string> = {}
  for (const name of context.usedComponents) {
    if (name === plan.definition.name) continue
    const nested = environment.components.get(name)
    if (nested) registrations[nested.tag] = `./${nested.slug}`
  }
  return `<template>
  <view class="op-component">
${template}
  </view>
</template>

<script>
import { createComponent } from '@mpxjs/core'

createComponent({})
</script>

<script type="application/json">
${embeddedJSON({ component: true, usingComponents: registrations })}
</script>

<style>
.op-component { box-sizing: border-box; position: relative; }
${styleSheet(context.styles)}
</style>
`
}

function createTemplateContext(
  environment: MpxEnvironment,
  assetPrefix: string
): MpxTemplateContext {
  return {
    ...environment,
    assetPrefix,
    localNames: new Set(),
    methods: new Map(),
    styles: new Map(),
    usedComponents: new Set()
  }
}

function renderNode(node: IRNode, level: number, context: MpxTemplateContext): string {
  const indentation = '  '.repeat(level)
  switch (node.kind) {
    case 'text':
      if (node.values?.length) warnMiniProgramUnsupported(context.warn, 'mpx', 'i18n-interpolation')
      return `${indentation}<text>${escapeMiniProgramMarkupText(node.value)}</text>`
    case 'expression': {
      const expression = emitExpression(node.ast)
      const result = node.fallback
        ? `${expression} ?? ${JSON.stringify(node.fallback)}`
        : expression
      return `${indentation}<text>{{ ${escapeMiniProgramTemplateExpression(result)} }}</text>`
    }
    case 'conditional': {
      const condition = escapeMiniProgramTemplateExpression(emitExpression(node.ast))
      const content = renderNode(node.consequent, level + 1, context)
      return `${indentation}<block wx:if="{{ ${condition} }}">\n${content}\n${indentation}</block>`
    }
    case 'list': {
      if (![node.arrayName, node.itemName, node.indexName].every(validIdentifier)) {
        warnMiniProgramUnsupported(context.warn, 'mpx', 'unsafe-list-identifier')
        return `${indentation}<block />`
      }
      const locals = new Set([...context.localNames, node.itemName, node.indexName])
      const content = renderNode(node.template, level + 1, { ...context, localNames: locals })
      return `${indentation}<block wx:for="{{ ${node.arrayName} }}" wx:for-item="${node.itemName}" wx:for-index="${node.indexName}" wx:key="*this">\n${content}\n${indentation}</block>`
    }
    case 'componentRef':
      return renderComponentReference(node, level, context)
    default:
      return renderElement(node, level, context)
  }
}

function renderComponentReference(
  node: Extract<IRNode, { kind: 'componentRef' }>,
  level: number,
  context: MpxTemplateContext
): string {
  if (node.motion || node.motionDrivers || node.prototype)
    warnMiniProgramUnsupported(context.warn, 'mpx', 'component-runtime', node.sourceId)
  if (node.events)
    warnMiniProgramUnsupported(context.warn, 'mpx', 'component-events', node.sourceId)
  if (node.props.length)
    warnMiniProgramUnsupported(context.warn, 'mpx', 'component-property-overrides', node.sourceId)
  const plan = context.components.get(node.name)
  if (!plan) {
    warnMiniProgramUnsupported(context.warn, 'mpx', 'missing-component', node.sourceId)
    return `${'  '.repeat(level)}<view />`
  }
  context.usedComponents.add(node.name)
  const className = recordStyle(node.sourceId, node.className, node.styleAttr, context)
  return `${'  '.repeat(level)}<${plan.tag}${className ? ` class="${className}"` : ''} />`
}

function renderElement(node: IRElement, level: number, context: MpxTemplateContext): string {
  warnNodeFeatures(node, context)
  const tag = miniProgramElementTag(node)
  const attributes: string[] = []
  const style = node.attrs.style
  const className = recordStyle(
    node.sourceId,
    node.className,
    style && typeof style === 'object' && style.kind === 'styleAttr' ? style : undefined,
    context
  )
  if (className) attributes.push(`class="${className}"`)
  if (tag === 'image') {
    const source = mpxImageSource(node, context)
    if (source) attributes.push(`src="${escapeMiniProgramMarkupAttribute(source)}"`)
  }
  attributes.push(...staticAttributes(node))
  const model = mpxModel(node, context)
  if (model) attributes.push(model)
  attributes.push(...eventBindings(node, context))
  const attributeSource = attributes.length ? ` ${attributes.join(' ')}` : ''
  const indentation = '  '.repeat(level)
  if (tag === 'image' || tag === 'input' || tag === 'textarea') {
    return `${indentation}<${tag}${attributeSource} />`
  }
  if (node.rawHtml) return `${indentation}<${tag}${attributeSource} />`
  const content = node.children.map((child) => renderNode(child, level + 1, context)).join('\n')
  return content
    ? `${indentation}<${tag}${attributeSource}>\n${content}\n${indentation}</${tag}>`
    : `${indentation}<${tag}${attributeSource} />`
}

function recordStyle(
  sourceId: string,
  classes: string,
  inline: Parameters<typeof translateMiniProgramStyle>[1],
  context: MpxTemplateContext
): string | undefined {
  const result = translateMiniProgramStyle(classes, inline)
  if (result.unsupportedUtilities.length)
    warnMiniProgramUnsupported(context.warn, 'mpx', 'style-utility', sourceId)
  const declarations = { ...result.declarations }
  if (result.backgroundAsset) {
    const asset = context.assets.resolve(result.backgroundAsset)
    if (asset) declarations['background-image'] = `url('${context.assetPrefix}${assetTail(asset)}')`
    else warnMiniProgramUnsupported(context.warn, 'mpx', 'background-image', sourceId)
  }
  if (!Object.keys(declarations).length) return undefined
  const className = stableMiniProgramClassName(sourceId)
  context.styles.set(className, emitMiniProgramCSSDeclarations(declarations))
  return className
}

function mpxImageSource(node: IRElement, context: MpxTemplateContext): string | undefined {
  if (node.image?.srcExpr) {
    warnMiniProgramUnsupported(context.warn, 'mpx', 'dynamic-image-source', node.sourceId)
    return undefined
  }
  if (node.image?.sources?.length)
    warnMiniProgramUnsupported(context.warn, 'mpx', 'responsive-image', node.sourceId)
  const value = node.image?.srcLiteral ?? staticMiniProgramAttr(node.attrs.src)
  if (!value) return undefined
  const asset = context.assets.resolve(value)
  if (!asset) {
    warnMiniProgramUnsupported(context.warn, 'mpx', 'remote-or-missing-image', node.sourceId)
    return undefined
  }
  return `${context.assetPrefix}${assetTail(asset)}`
}

function staticAttributes(node: IRElement): string[] {
  return Object.entries(node.attrs).flatMap(([name, raw]) => {
    if (name === 'type' && node.tag === 'input') {
      const value = staticMiniProgramAttr(raw)
      return value && MPX_INPUT_TYPES.has(value) ? [`type="${value}"`] : []
    }
    if (!MPX_STATIC_ATTRS.has(name)) return []
    if (typeof raw === 'boolean') return raw ? [name] : []
    const value = staticMiniProgramAttr(raw)
    return value === undefined ? [] : [`${name}="${escapeMiniProgramMarkupAttribute(value)}"`]
  })
}

function mpxModel(node: IRElement, context: MpxTemplateContext): string | undefined {
  const controlled = node.controlled
  if (!controlled) return undefined
  if (controlled.write.kind !== 'state') {
    warnMiniProgramUnsupported(
      context.warn,
      'mpx',
      'document-state-controlled-input',
      node.sourceId
    )
    return undefined
  }
  if (!validIdentifier(controlled.write.name) || controlled.write.targetType === 'array') {
    warnMiniProgramUnsupported(context.warn, 'mpx', 'controlled-input', node.sourceId)
    return undefined
  }
  return `wx:model="{{ ${controlled.write.name} }}"`
}

function eventBindings(node: IRElement, context: MpxTemplateContext): string[] {
  const bindingNames: Readonly<Partial<Record<string, string>>> = {
    onClick: 'bindtap',
    onChange: 'bindchange',
    onSubmit: 'bindsubmit',
    onFocus: 'bindfocus',
    onBlur: 'bindblur'
  }
  return Object.entries(node.events ?? {}).flatMap(([eventName, handlers]) => {
    const binding = bindingNames[eventName]
    if (!binding || !handlers.length) return []
    const method = registerMethod(node.sourceId, eventName, handlers, context)
    if (!method) return []
    const suffix = method.parameters.length ? `(${method.parameters.join(', ')})` : ''
    return [`${binding}="${method.name}${suffix}"`]
  })
}

function registerMethod(
  sourceId: string,
  eventName: string,
  handlers: readonly IREventHandler[],
  context: MpxTemplateContext
): { name: string; parameters: string[] } | undefined {
  const name = safeMiniProgramIdentifier(`op_${eventName}_${stableMiniProgramClassName(sourceId)}`)
  const body: string[] = []
  const parameters = new Set<string>()
  for (const handler of handlers) {
    const emitted = eventStatement(handler, sourceId, context, parameters)
    if (emitted) body.push(...emitted)
  }
  if (!body.length) return undefined
  const method = { body, parameters: [...parameters] }
  context.methods.set(name, method)
  return { name, parameters: method.parameters }
}

function eventStatement(
  handler: IREventHandler,
  nodeId: string,
  context: MpxTemplateContext,
  parameters: Set<string>
): string[] | undefined {
  if (handler.kind === 'setVariable') {
    warnMiniProgramUnsupported(context.warn, 'mpx', 'document-state-action', nodeId)
    return undefined
  }
  if (handler.kind !== 'setState') {
    warnMiniProgramUnsupported(context.warn, 'mpx', miniProgramEventFeature(handler), nodeId)
    return undefined
  }
  const target = handler.stateName
  if (!validIdentifier(target)) {
    warnMiniProgramUnsupported(context.warn, 'mpx', 'unsafe-state-identifier', nodeId)
    return undefined
  }
  const locals = handler.references.filter((reference) => context.localNames.has(reference))
  for (const local of locals) parameters.add(local)
  const stateReferences = handler.references.filter(
    (reference) => !context.localNames.has(reference) && validIdentifier(reference)
  )
  const lines = ['{']
  if (handler.mode === 'functional') lines.push(`  const prev = this.${target}`)
  if (stateReferences.length) lines.push(`  const { ${stateReferences.join(', ')} } = this`)
  lines.push(`  this.${target} = ${emitExpression(handler.ast)}`, '}')
  return lines
}

function pageScript(
  data: Record<string, unknown>,
  methods: ReadonlyMap<string, RegisteredMethod>
): string {
  const fields = [`  data: ${embeddedJSON(data).replaceAll('\n', '\n  ')}`]
  for (const [name, method] of methods) {
    const parameters = method.parameters.join(', ')
    const body = method.body.map((line) => `    ${line}`).join('\n')
    fields.push(`  ${name}(${parameters}) {\n${body}\n  }`)
  }
  return `import { createPage } from '@mpxjs/core'\n\ncreatePage({\n${fields.join(',\n')}\n})`
}

function pageData(ir: IRTree, environment: MpxEnvironment): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const state of [...ir.states, ...ir.docStates]) {
    if (Object.hasOwn(data, state.name)) continue
    if (!validIdentifier(state.name)) {
      warnMiniProgramUnsupported(environment.warn, 'mpx', 'unsafe-state-identifier', state.id)
      continue
    }
    if (state.computed || state.computedInvalid)
      warnMiniProgramUnsupported(environment.warn, 'mpx', 'computed-state', state.id)
    if (state.persist)
      warnMiniProgramUnsupported(environment.warn, 'mpx', 'persistent-state', state.id)
    data[state.name] = safeDefault(state)
  }
  return data
}

function safeDefault(state: IRStateDecl): unknown {
  if (state.type === 'string')
    return typeof state.defaultValue === 'string' ? state.defaultValue : ''
  if (state.type === 'number')
    return typeof state.defaultValue === 'number' && Number.isFinite(state.defaultValue)
      ? state.defaultValue
      : 0
  if (state.type === 'boolean') return state.defaultValue === true
  if (state.type === 'array') return Array.isArray(state.defaultValue) ? state.defaultValue : []
  return state.defaultValue &&
    typeof state.defaultValue === 'object' &&
    !Array.isArray(state.defaultValue)
    ? state.defaultValue
    : {}
}

function warnDefinitionFeatures(definition: ComponentDef, environment: MpxEnvironment): void {
  const checks: Array<[boolean, string]> = [
    [
      definition.props.length > 0 || Boolean(definition.variantAxes?.length),
      'component-property-overrides'
    ],
    [Boolean(definition.variants?.length), 'component-variants'],
    [
      Boolean(definition.docStateReads?.length || definition.docStateWrites?.length),
      'component-document-state'
    ],
    [Boolean(definition.validatedFields?.length), 'component-validation'],
    [Boolean(definition.prototypeBody), 'prototype']
  ]
  checks.forEach(([present, feature]) => {
    if (present)
      warnMiniProgramUnsupported(environment.warn, 'mpx', feature, definition.componentId)
  })
}

function warnNodeFeatures(node: IRElement, context: MpxTemplateContext): void {
  const features: Array<[unknown, string]> = [
    [node.motion || node.motionDrivers || node.motionScene, 'motion'],
    [node.prototype, 'prototype'],
    [node.generatedEffect, 'generated-effect'],
    [node.upload, 'upload'],
    [node.module, 'plugin-module'],
    [node.rawHtml, 'raw-html'],
    [node.overlay, 'overlay'],
    [node.link, 'external-link'],
    [node.icon, 'icon-runtime'],
    [
      node.validation || node.formValidationKeys?.length || node.formValidationSummary,
      'form-validation'
    ],
    [node.display || node.displayKind, 'display-primitive']
  ]
  for (const [value, feature] of features) {
    if (value) warnMiniProgramUnsupported(context.warn, 'mpx', feature, node.sourceId)
  }
}

function styleSheet(styles: ReadonlyMap<string, string>): string {
  return [...styles]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `.${name} { ${value} }`)
    .join('\n')
}

function embeddedJSON(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function validIdentifier(value: string): boolean {
  return IDENTIFIER.test(value) && safeMiniProgramIdentifier(value) === value
}

function assetTail(path: string): string {
  return path.startsWith('assets/') ? path.slice('assets/'.length) : path
}
