import type {
  ComponentDef,
  IRElement,
  IREventHandler,
  IRNode,
  IRStateDecl,
  IRTree
} from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

import {
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
} from '../miniprogram-shared'
import type { UniAppComponentPlan, UniAppEmitEnvironment } from './types'

interface TemplateContext extends UniAppEmitEnvironment {
  styles: Map<string, string>
  usedComponents: Set<string>
}

const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const SAFE_INPUT_TYPES = new Set(['text', 'number', 'password', 'digit', 'idcard', 'nickname'])
const STATIC_ATTRIBUTES = new Set([
  'disabled',
  'maxlength',
  'name',
  'placeholder',
  'readonly',
  'type'
])

export function emitUniAppPage(ir: IRTree, environment: UniAppEmitEnvironment): string {
  warnMiniProgramPageFeatures(ir, environment.warn, 'uni-app', 'uni-app')
  const context: TemplateContext = {
    ...environment,
    styles: new Map(),
    usedComponents: new Set()
  }
  const body = ir.children.map((node) => emitNode(node, 2, context)).join('\n')
  const imports = [...context.usedComponents]
    .map((name) => environment.components.get(name))
    .filter((value): value is UniAppComponentPlan => value !== undefined)
    .map((component) => `import ${component.symbol} from '../../${component.filePath}'`)
  const states = emitStateDeclarations(ir, environment)
  const script = [...(states ? [`import { ref } from 'vue'`] : []), ...imports, states]
    .filter(Boolean)
    .join('\n')
  return `<template>
  <view class="op-page">
${body}
  </view>
</template>

<script setup>
${script}
</script>

<style scoped>
.op-page { box-sizing: border-box; min-height: 100vh; position: relative; }
${emitStyleRules(context.styles)}
</style>
`
}

export function emitUniAppComponent(
  plan: UniAppComponentPlan,
  environment: UniAppEmitEnvironment
): string {
  warnComponentFeatures(plan.definition, environment)
  const context: TemplateContext = {
    ...environment,
    styles: new Map(),
    usedComponents: new Set()
  }
  const nodes = componentNodes(plan.definition)
  const body = nodes.map((node) => emitNode(node, 1, context)).join('\n')
  const imports = [...context.usedComponents]
    .filter((name) => name !== plan.definition.name)
    .map((name) => environment.components.get(name))
    .filter((value): value is UniAppComponentPlan => value !== undefined)
    .map((component) => `import ${component.symbol} from './${component.slug}.vue'`)
    .join('\n')
  return `<template>
  <view class="op-component">
${body}
  </view>
</template>

<script setup>
${imports}
</script>

<style scoped>
.op-component { box-sizing: border-box; position: relative; }
${emitStyleRules(context.styles)}
</style>
`
}

function emitNode(node: IRNode, depth: number, context: TemplateContext): string {
  const pad = '  '.repeat(depth)
  if (node.kind === 'text') {
    if (node.values?.length) {
      warnMiniProgramUnsupported(context.warn, 'uni-app', 'i18n-interpolation')
    }
    return `${pad}<text>${escapeMiniProgramMarkupText(node.value)}</text>`
  }
  if (node.kind === 'expression') {
    const expression = emitExpression(node.ast)
    const value = node.fallback ? `${expression} ?? ${JSON.stringify(node.fallback)}` : expression
    return `${pad}<text>{{ ${escapeMiniProgramTemplateExpression(value)} }}</text>`
  }
  if (node.kind === 'conditional') {
    const expression = escapeMiniProgramTemplateExpression(emitExpression(node.ast))
    const child = emitNode(node.consequent, depth + 1, context)
    return `${pad}<template v-if="${expression}">\n${child}\n${pad}</template>`
  }
  if (node.kind === 'list') {
    if (![node.arrayName, node.itemName, node.indexName].every(isSafeIdentifier)) {
      warnMiniProgramUnsupported(context.warn, 'uni-app', 'unsafe-list-identifier')
      return `${pad}<template><!-- OpenPencil omitted an unsafe list binding. --></template>`
    }
    const item = escapeMiniProgramMarkupAttribute(node.itemName)
    const index = escapeMiniProgramMarkupAttribute(node.indexName)
    const array = escapeMiniProgramMarkupAttribute(node.arrayName)
    const child = emitNode(node.template, depth + 1, context)
    return `${pad}<template v-for="(${item}, ${index}) in ${array}" :key="${index}">\n${child}\n${pad}</template>`
  }
  if (node.kind === 'componentRef') return emitComponentReference(node, depth, context)
  return emitElement(node, depth, context)
}

function emitComponentReference(
  node: Extract<IRNode, { kind: 'componentRef' }>,
  depth: number,
  context: TemplateContext
): string {
  warnDecorationFeatures(node, context)
  if (node.events)
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'component-events', node.sourceId)
  if (node.props.length > 0) {
    warnMiniProgramUnsupported(
      context.warn,
      'uni-app',
      'component-property-overrides',
      node.sourceId
    )
  }
  const component = context.components.get(node.name)
  if (!component) {
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'missing-component', node.sourceId)
    return `${'  '.repeat(depth)}<view />`
  }
  context.usedComponents.add(node.name)
  const className = registerStyle(node.sourceId, node.className, node.styleAttr, context)
  const classAttr = className ? ` class="${className}"` : ''
  return `${'  '.repeat(depth)}<${component.symbol}${classAttr} />`
}

function emitElement(node: IRElement, depth: number, context: TemplateContext): string {
  warnElementFeatures(node, context)
  if (node.rawHtml) warnMiniProgramUnsupported(context.warn, 'uni-app', 'raw-html', node.sourceId)
  const tag = miniProgramElementTag(node)
  const className = registerStyle(node.sourceId, node.className, styleAttribute(node), context)
  const attrs = className ? [`class="${className}"`] : []
  const imageSource = tag === 'image' ? resolveImageSource(node, context) : undefined
  if (imageSource) attrs.push(`src="${escapeMiniProgramMarkupAttribute(imageSource)}"`)
  attrs.push(...emitStaticAttributes(node))
  const model = emitModelDirective(node, context)
  if (model) attrs.push(model)
  attrs.push(...emitEventDirectives(node, context))
  const joined = attrs.length ? ` ${attrs.join(' ')}` : ''
  if (tag === 'image' || tag === 'input' || tag === 'textarea') {
    return `${'  '.repeat(depth)}<${tag}${joined} />`
  }
  const children = node.rawHtml
    ? ''
    : node.children.map((child) => emitNode(child, depth + 1, context)).join('\n')
  if (!children) return `${'  '.repeat(depth)}<${tag}${joined} />`
  const pad = '  '.repeat(depth)
  return `${pad}<${tag}${joined}>\n${children}\n${pad}</${tag}>`
}

function registerStyle(
  sourceId: string,
  className: string,
  styleAttr: ReturnType<typeof styleAttribute>,
  context: TemplateContext
): string | undefined {
  const translated = translateMiniProgramStyle(className, styleAttr)
  if (translated.unsupportedUtilities.length > 0) {
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'style-utility', sourceId)
  }
  const declarations = { ...translated.declarations }
  if (translated.backgroundAsset) {
    const resolved = context.assets.resolve(translated.backgroundAsset)
    if (resolved) declarations['background-image'] = `url('/static/${assetSuffix(resolved)}')`
    else warnMiniProgramUnsupported(context.warn, 'uni-app', 'background-image', sourceId)
  }
  if (Object.keys(declarations).length === 0) return undefined
  const generated = stableMiniProgramClassName(sourceId)
  context.styles.set(generated, emitMiniProgramCSSDeclarations(declarations))
  return generated
}

function resolveImageSource(node: IRElement, context: TemplateContext): string | undefined {
  if (node.image?.srcExpr) {
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'dynamic-image-source', node.sourceId)
    return undefined
  }
  if (node.image?.sources?.length) {
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'responsive-image', node.sourceId)
  }
  const authored = node.image?.srcLiteral ?? staticMiniProgramAttr(node.attrs.src)
  if (!authored) return undefined
  const resolved = context.assets.resolve(authored)
  if (!resolved) {
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'remote-or-missing-image', node.sourceId)
    return undefined
  }
  return `/static/${assetSuffix(resolved)}`
}

function emitStaticAttributes(node: IRElement): string[] {
  const attributes: string[] = []
  for (const [name, raw] of Object.entries(node.attrs)) {
    if (
      !STATIC_ATTRIBUTES.has(name) ||
      (name === 'type' && node.tag !== 'input' && node.tag !== 'button')
    ) {
      continue
    }
    if (name === 'type' && node.tag === 'input') {
      const type = staticMiniProgramAttr(raw)
      if (!type || !SAFE_INPUT_TYPES.has(type)) continue
    }
    if (typeof raw === 'boolean') {
      if (raw) attributes.push(name)
      continue
    }
    const value = staticMiniProgramAttr(raw)
    if (value !== undefined) {
      attributes.push(`${name}="${escapeMiniProgramMarkupAttribute(value)}"`)
    }
  }
  return attributes
}

function emitModelDirective(node: IRElement, context: TemplateContext): string | undefined {
  const controlled = node.controlled
  if (!controlled) return undefined
  if (controlled.write.kind !== 'state') {
    warnMiniProgramUnsupported(
      context.warn,
      'uni-app',
      'document-state-controlled-input',
      node.sourceId
    )
    return undefined
  }
  if (!isSafeIdentifier(controlled.write.name) || controlled.write.targetType === 'array') {
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'controlled-input', node.sourceId)
    return undefined
  }
  const modifier = controlled.write.targetType === 'number' ? '.number' : ''
  return `v-model${modifier}="${escapeMiniProgramMarkupAttribute(controlled.write.name)}"`
}

function emitEventDirectives(node: IRElement, context: TemplateContext): string[] {
  const names: Readonly<Partial<Record<string, string>>> = {
    onClick: '@tap',
    onChange: '@change',
    onSubmit: '@submit.prevent',
    onFocus: '@focus',
    onBlur: '@blur'
  }
  const directives: string[] = []
  for (const [eventName, handlers] of Object.entries(node.events ?? {})) {
    const directive = names[eventName]
    if (!directive || !handlers.length) continue
    const statements = handlers.flatMap((handler) =>
      emitInlineEventStatement(handler, node.sourceId, context)
    )
    if (statements.length > 0) {
      directives.push(
        `${directive}="${escapeMiniProgramTemplateExpression(statements.join('; '))}"`
      )
    }
  }
  return directives
}

function emitInlineEventStatement(
  handler: IREventHandler,
  nodeId: string,
  context: TemplateContext
): string[] {
  if (handler.kind === 'setVariable') {
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'document-state-action', nodeId)
    return []
  }
  if (
    handler.kind === 'setState' &&
    handler.mode === 'absolute' &&
    isSafeIdentifier(handler.stateName)
  ) {
    return [`${handler.stateName} = ${emitExpression(handler.ast)}`]
  }
  warnMiniProgramUnsupported(context.warn, 'uni-app', miniProgramEventFeature(handler), nodeId)
  return []
}

function emitStateDeclarations(ir: IRTree, environment: UniAppEmitEnvironment): string {
  const declarations: string[] = []
  const seen = new Set<string>()
  for (const state of [...ir.states, ...ir.docStates]) {
    if (seen.has(state.name)) continue
    seen.add(state.name)
    if (!isSafeIdentifier(state.name)) {
      warnMiniProgramUnsupported(environment.warn, 'uni-app', 'unsafe-state-identifier', state.id)
      continue
    }
    if (state.computed || state.computedInvalid) {
      warnMiniProgramUnsupported(environment.warn, 'uni-app', 'computed-state', state.id)
    }
    if (state.persist) {
      warnMiniProgramUnsupported(environment.warn, 'uni-app', 'persistent-state', state.id)
    }
    declarations.push(`const ${state.name} = ref(${stateDefaultLiteral(state)})`)
  }
  return declarations.join('\n')
}

function stateDefaultLiteral(state: IRStateDecl): string {
  if (state.type === 'string')
    return safeScriptJSON(typeof state.defaultValue === 'string' ? state.defaultValue : '')
  if (state.type === 'number') {
    return String(
      typeof state.defaultValue === 'number' && Number.isFinite(state.defaultValue)
        ? state.defaultValue
        : 0
    )
  }
  if (state.type === 'boolean') return state.defaultValue === true ? 'true' : 'false'
  if (state.type === 'array')
    return safeScriptJSON(Array.isArray(state.defaultValue) ? state.defaultValue : [])
  return safeScriptJSON(isPlainObject(state.defaultValue) ? state.defaultValue : {})
}

function warnComponentFeatures(definition: ComponentDef, environment: UniAppEmitEnvironment): void {
  if (definition.props.length || definition.variantAxes?.length) {
    warnMiniProgramUnsupported(
      environment.warn,
      'uni-app',
      'component-property-overrides',
      definition.componentId
    )
  }
  if (definition.variants?.length) {
    warnMiniProgramUnsupported(
      environment.warn,
      'uni-app',
      'component-variants',
      definition.componentId
    )
  }
  if (definition.docStateReads?.length || definition.docStateWrites?.length) {
    warnMiniProgramUnsupported(
      environment.warn,
      'uni-app',
      'component-document-state',
      definition.componentId
    )
  }
  if (definition.validatedFields?.length) {
    warnMiniProgramUnsupported(
      environment.warn,
      'uni-app',
      'component-validation',
      definition.componentId
    )
  }
  if (definition.prototypeBody) {
    warnMiniProgramUnsupported(environment.warn, 'uni-app', 'prototype', definition.componentId)
  }
}

function warnElementFeatures(node: IRElement, context: TemplateContext): void {
  warnDecorationFeatures(node, context)
  if (node.motionScene || node.generatedEffect)
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'advanced-visual-runtime', node.sourceId)
  if (node.upload) warnMiniProgramUnsupported(context.warn, 'uni-app', 'upload', node.sourceId)
  if (node.module)
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'plugin-module', node.sourceId)
  if (node.overlay) warnMiniProgramUnsupported(context.warn, 'uni-app', 'overlay', node.sourceId)
  if (node.link) warnMiniProgramUnsupported(context.warn, 'uni-app', 'external-link', node.sourceId)
  if (node.icon) warnMiniProgramUnsupported(context.warn, 'uni-app', 'icon-runtime', node.sourceId)
  if (node.validation || node.formValidationKeys?.length || node.formValidationSummary) {
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'form-validation', node.sourceId)
  }
  if (node.display || node.displayKind)
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'display-primitive', node.sourceId)
}

function warnDecorationFeatures(
  node: Pick<IRElement, 'sourceId' | 'motion' | 'motionDrivers' | 'prototype'>,
  context: TemplateContext
): void {
  if (node.motion || node.motionDrivers)
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'motion', node.sourceId)
  if (node.prototype)
    warnMiniProgramUnsupported(context.warn, 'uni-app', 'prototype', node.sourceId)
}

function componentNodes(definition: ComponentDef): readonly IRNode[] {
  return definition.variants?.[0]?.children ?? definition.children
}

function styleAttribute(
  node: IRElement
): Extract<typeof node.attrs.style, { kind: 'styleAttr' }> | undefined {
  const style = node.attrs.style
  return style && typeof style === 'object' && style.kind === 'styleAttr' ? style : undefined
}

function emitStyleRules(styles: ReadonlyMap<string, string>): string {
  return [...styles]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([className, declarations]) => `.${className} { ${declarations} }`)
    .join('\n')
}

function assetSuffix(path: string): string {
  return path.startsWith('assets/') ? path.slice('assets/'.length) : path
}

function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value) && safeMiniProgramIdentifier(value) === value
}

function safeScriptJSON(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
