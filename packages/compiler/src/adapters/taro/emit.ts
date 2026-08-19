import type {
  ComponentDef,
  IRAttrValue,
  IRComponentRef,
  IRElement,
  IRNode,
  IRStateDecl,
  IRTree
} from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

import {
  emitMiniProgramCSSDeclarations,
  miniProgramElementTag,
  safeMiniProgramIdentifier,
  stableMiniProgramClassName,
  staticMiniProgramAttr,
  translateMiniProgramStyle,
  type MiniProgramAssetPlan,
  type MiniProgramPagePlan,
  type MiniProgramWarningSink
} from '../miniprogram-shared'
import { emitTaroEventAttributes, taroStateSetter } from './events'
import {
  createTaroComponentPropAliases,
  createTaroExpressionBindings,
  emitTaroExpression,
  type TaroExpressionBindings
} from './expression'
import { warnTaroComponentDefinitionRuntime, warnTaroComponentReferenceRuntime } from './warnings'

export interface TaroComponentPlan {
  definition: ComponentDef
  identifier: string
  propAliases: ReadonlyMap<string, string>
  slug: string
}

export interface TaroEmitEnvironment {
  assets: MiniProgramAssetPlan
  components: ReadonlyMap<string, TaroComponentPlan>
  routeByAuthoredPath: ReadonlyMap<string, string>
  warn: MiniProgramWarningSink
}

export interface TaroPageEmission {
  source: string
  style: string
}

interface EmitContext extends TaroEmitEnvironment {
  componentImports: Set<string>
  componentMode: boolean
  expressionBindings: TaroExpressionBindings
  styleSheet: TaroStyleSheet
  stateNames: ReadonlySet<string>
}

const SAFE_IMAGE_SOURCE = /^(?:\.?\.?\/)*assets\/[A-Za-z0-9._/-]+$/
const BACKGROUND_ASSET = /^bg-\[url\(\.\/assets\/([A-Za-z0-9._/-]+)\)\]$/

class TaroStyleSheet {
  readonly #rules: string[] = []
  readonly #used = new Set<string>()

  constructor(
    private readonly assets: MiniProgramAssetPlan,
    private readonly assetPrefix: string,
    private readonly warn: MiniProgramWarningSink
  ) {}

  register(node: IRElement | IRComponentRef): string | undefined {
    const classUtilities: string[] = []
    const declarations: Record<string, string> = {}
    for (const utility of node.className.split(/\s+/).filter(Boolean)) {
      const match = BACKGROUND_ASSET.exec(utility)
      if (!match) {
        classUtilities.push(utility)
        continue
      }
      const outputPath = this.assets.resolve(match[1])
      if (!outputPath) {
        this.warn({
          code: 'taro-image-local-source-unavailable',
          message: `Taro could not resolve local background image ${JSON.stringify(match[1])}`,
          nodeId: node.sourceId
        })
        continue
      }
      declarations['background-image'] = `url('${this.assetPrefix}${outputPath}')`
    }
    const styleAttr = node.kind === 'element' ? styleAttribute(node.attrs.style) : node.styleAttr
    const translated = translateMiniProgramStyle(classUtilities.join(' '), styleAttr)
    Object.assign(declarations, translated.declarations)
    if (translated.backgroundAsset) {
      const outputPath = this.assets.resolve(translated.backgroundAsset)
      if (outputPath) declarations['background-image'] = `url('${this.assetPrefix}${outputPath}')`
      else {
        this.warn({
          code: 'taro-image-local-source-unavailable',
          message: `Taro could not resolve local background image ${JSON.stringify(translated.backgroundAsset)}`,
          nodeId: node.sourceId
        })
      }
    }
    for (const utility of translated.unsupportedUtilities) {
      this.warn({
        code: utility.startsWith('style:')
          ? 'taro-inline-style-unsupported'
          : 'taro-style-unsupported',
        message: `Taro omitted unsupported style ${JSON.stringify(utility)}`,
        nodeId: node.sourceId
      })
    }
    if (Object.keys(declarations).length === 0) return undefined
    const base = stableMiniProgramClassName(node.sourceId)
    let name = base
    let sequence = 2
    while (this.#used.has(name)) name = `${base}-${sequence++}`
    this.#used.add(name)
    this.#rules.push(`.${name} { ${emitMiniProgramCSSDeclarations(declarations)} }`)
    return name
  }

  source(): string {
    return this.#rules.length > 0 ? `${this.#rules.join('\n\n')}\n` : ''
  }
}

function styleAttribute(value: IRAttrValue | undefined) {
  return value && typeof value === 'object' && value.kind === 'styleAttr' ? value : undefined
}

export function emitTaroPage(
  plan: MiniProgramPagePlan,
  environment: TaroEmitEnvironment
): TaroPageEmission {
  const componentImports = new Set<string>()
  const styleSheet = new TaroStyleSheet(environment.assets, '../../', environment.warn)
  const stateNames = new Set(plan.ir.states.map((state) => state.name))
  const ctx: EmitContext = {
    ...environment,
    componentImports,
    componentMode: false,
    expressionBindings: new Map(),
    styleSheet,
    stateNames
  }
  auditTreeRuntime(plan.ir, environment.warn)
  const body = plan.ir.children.map((node) => emitNode(node, ctx, 3)).join('\n')
  const hooks = emitPageHooks(plan.ir)
  const componentImportSource = [...componentImports]
    .sort()
    .map((name) => {
      const component = environment.components.get(name)
      return component
        ? `import ${component.identifier} from '../../components/${component.slug}'`
        : ''
    })
    .filter(Boolean)
    .join('\n')
  return {
    source: `import { useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Checkbox, Form, Image, Input, Label, Picker, Radio, Switch, Text, Textarea, View } from '@tarojs/components'
${componentImportSource ? `${componentImportSource}\n` : ''}
import './index.scss'

export default function ${safeMiniProgramIdentifier(`${plan.slug}Page`, 'GeneratedPage')}() {
${hooks}
  return (
    <View>
${body || '      <View />'}
    </View>
  )
}
`,
    style: styleSheet.source()
  }
}

export function emitTaroComponent(
  component: TaroComponentPlan,
  environment: TaroEmitEnvironment
): TaroPageEmission {
  const componentImports = new Set<string>()
  const styleSheet = new TaroStyleSheet(environment.assets, '../', environment.warn)
  const ctx: EmitContext = {
    ...environment,
    componentImports,
    componentMode: true,
    expressionBindings: createTaroExpressionBindings(component.propAliases),
    styleSheet,
    stateNames: new Set()
  }
  const definition = component.definition
  warnTaroComponentDefinitionRuntime(definition, environment.warn)
  if (definition.docStateReads?.length || definition.docStateWrites?.length) {
    environment.warn({
      code: 'taro-component-document-state-unsupported',
      message: `Taro rendered component ${JSON.stringify(definition.name)} without document-state wiring`,
      nodeId: definition.componentId
    })
  }
  if (definition.validatedFields?.length) {
    environment.warn({
      code: 'taro-component-validation-unsupported',
      message: `Taro rendered component ${JSON.stringify(definition.name)} without field validation`,
      nodeId: definition.componentId
    })
  }
  const children = definition.variants?.[0]?.children ?? definition.children
  if (definition.variants?.length) {
    environment.warn({
      code: 'taro-component-variants-static-fallback',
      message: `Taro rendered the first static variant of component ${JSON.stringify(definition.name)}`,
      nodeId: definition.componentId
    })
  }
  for (const prop of definition.props) {
    if (prop.kind === 'text' && prop.name !== 'className') continue
    environment.warn({
      code: 'taro-component-prop-unsupported',
      message: `Taro omitted unsupported ${prop.kind} prop ${JSON.stringify(prop.name)} from component ${JSON.stringify(definition.name)}`,
      nodeId: definition.componentId
    })
  }
  const props = definition.props
    .filter((prop) => prop.kind === 'text' && prop.name !== 'className')
    .map((prop) => ({
      defaultValue: prop.defaultValue,
      name: component.propAliases.get(prop.name) ?? safeMiniProgramIdentifier(prop.name, 'prop')
    }))
  const propsType = props.length
    ? `interface Props {\n${props.map(({ name }) => `  ${name}?: string`).join('\n')}\n  className?: string\n}\n\n`
    : `interface Props { className?: string }\n\n`
  const destructure = [
    ...props.map(({ defaultValue, name }) => `${name} = ${JSON.stringify(defaultValue)}`),
    'className'
  ].join(', ')
  const body = children.map((node) => emitNode(node, ctx, 3)).join('\n')
  const componentImportSource = [...componentImports]
    .sort()
    .map((name) => {
      const nested = environment.components.get(name)
      return nested && nested.identifier !== component.identifier
        ? `import ${nested.identifier} from './${nested.slug}'`
        : ''
    })
    .filter(Boolean)
    .join('\n')
  return {
    source: `import Taro from '@tarojs/taro'
import { Button, Checkbox, Form, Image, Input, Label, Picker, Radio, Switch, Text, Textarea, View } from '@tarojs/components'
${componentImportSource ? `${componentImportSource}\n` : ''}

import './${component.slug}.scss'

${propsType}export default function ${component.identifier}({ ${destructure} }: Props) {
  return (
    <View className={className}>
${body || '      <View />'}
    </View>
  )
}
`,
    style: styleSheet.source()
  }
}

function auditTreeRuntime(ir: IRTree, warn: MiniProgramWarningSink): void {
  if (ir.motion || ir.motionDrivers || ir.motionScene || ir.prototype) {
    warn({
      code: 'taro-page-motion-unsupported',
      message: `Taro emitted page ${JSON.stringify(ir.pageName)} without Motion or prototype runtime`,
      nodeId: ir.pageId
    })
  }
  if (ir.supabaseConfig || ir.listQueries?.length) {
    warn({
      code: 'taro-supabase-unsupported',
      message: 'Taro omitted Supabase runtime and did not emit its URL or anon key',
      nodeId: ir.pageId
    })
  }
  if (ir.serverWorkflows?.length) {
    warn({
      code: 'taro-server-workflows-unsupported',
      message: 'Taro omitted server workflows and their runtime configuration',
      nodeId: ir.pageId
    })
  }
  if (ir.analyticsConfig) {
    warn({
      code: 'taro-analytics-unsupported',
      message: 'Taro omitted analytics configuration',
      nodeId: ir.pageId
    })
  }
  if (ir.requiresAuth) {
    warn({
      code: 'taro-auth-guard-unsupported',
      message: 'Taro omitted the authored web authentication guard',
      nodeId: ir.pageId
    })
  }
  if (ir.docStates.length || ir.docStateReads.length || ir.docStateWrites.length) {
    warn({
      code: 'taro-document-state-page-local-fallback',
      message: `Taro rendered document state on page ${JSON.stringify(ir.pageName)} as read-only page-local defaults`,
      nodeId: ir.pageId
    })
  }
}

function emitPageHooks(ir: IRTree): string {
  const lines: string[] = []
  if (ir.usesRouteParams || ir.usesQueryParams) {
    lines.push('  const __router = useRouter()')
    if (ir.usesRouteParams) lines.push('  const $params = __router.params')
    if (ir.usesQueryParams) lines.push('  const $query = __router.params')
  }
  for (const state of ir.states) lines.push(`  ${emitStateDeclaration(state)}`)
  for (const state of ir.docStates) {
    lines.push(`  const ${state.name} = ${safeStateDefault(state)}`)
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

function emitStateDeclaration(state: IRStateDecl): string {
  if (state.computed) return `const ${state.name} = ${emitExpression(state.computed.ast)}`
  return `const [${state.name}, ${taroStateSetter(state.name)}] = useState(${safeStateDefault(state)})`
}

function safeStateDefault(state: IRStateDecl): string {
  const value = state.defaultValue
  if (state.type === 'string') return JSON.stringify(typeof value === 'string' ? value : '')
  if (state.type === 'number') {
    return String(typeof value === 'number' && Number.isFinite(value) ? value : 0)
  }
  if (state.type === 'boolean') return value === true ? 'true' : 'false'
  if (state.type === 'array') return JSON.stringify(Array.isArray(value) ? value : [])
  return JSON.stringify(value && typeof value === 'object' ? value : {})
}

function emitNode(node: IRNode, ctx: EmitContext, level: number): string {
  const pad = '  '.repeat(level)
  switch (node.kind) {
    case 'text':
      if (node.values?.length) {
        ctx.warn({
          code: 'taro-i18n-interpolation-unsupported',
          message: 'Taro emitted the source ICU message without runtime interpolation'
        })
      }
      return `${pad}{${JSON.stringify(node.value)}}`
    case 'expression':
      return `${pad}{${emitTaroExpression(node.ast, ctx.expressionBindings)}}`
    case 'conditional':
      return `${pad}{${emitTaroExpression(node.ast, ctx.expressionBindings)} && (\n${emitNode(node.consequent, ctx, level + 1)}\n${pad})}`
    case 'list':
      return `${pad}{${node.arrayName}.map((${node.itemName}, ${node.indexName}) => (\n${pad}  <View key={${node.indexName}}>\n${emitNode(node.template, ctx, level + 2)}\n${pad}  </View>\n${pad}))}`
    case 'componentRef':
      return emitComponentRef(node, ctx, level)
    case 'element':
      return emitElement(node, ctx, level)
  }
  throw new TypeError('Taro received an unsupported IR node kind')
}

function emitComponentRef(node: IRComponentRef, ctx: EmitContext, level: number): string {
  const pad = '  '.repeat(level)
  warnTaroComponentReferenceRuntime(node, ctx.warn)
  const component = ctx.components.get(node.name)
  if (!component) {
    ctx.warn({
      code: 'taro-component-reference-unavailable',
      message: `Taro could not resolve component ${JSON.stringify(node.name)}`,
      nodeId: node.sourceId
    })
    return `${pad}<View />`
  }
  ctx.componentImports.add(node.name)
  if (node.events && Object.keys(node.events).length) {
    ctx.warn({
      code: 'taro-component-event-unsupported',
      message: `Taro omitted events attached to component ${JSON.stringify(node.name)}`,
      nodeId: node.sourceId
    })
  }
  const className = ctx.styleSheet.register(node)
  const props = node.props.flatMap((prop) => {
    const alias = component.propAliases.get(prop.name)
    const supported =
      prop.kind === 'text' &&
      typeof prop.value === 'string' &&
      prop.name !== 'className' &&
      alias !== undefined
    if (!supported) {
      ctx.warn({
        code: 'taro-component-prop-unsupported',
        message: `Taro omitted unsupported ${prop.kind} prop ${JSON.stringify(prop.name)} from component usage ${JSON.stringify(node.name)}`,
        nodeId: node.sourceId
      })
      return []
    }
    return [`${alias}=${JSON.stringify(prop.value)}`]
  })
  if (className) props.push(`className=${JSON.stringify(className)}`)
  return `${pad}<${component.identifier}${props.length ? ` ${props.join(' ')}` : ''} />`
}

function emitElement(node: IRElement, ctx: EmitContext, level: number): string {
  const pad = '  '.repeat(level)
  auditElement(node, ctx)
  const component = taroComponent(node)
  const className = ctx.styleSheet.register(node)
  const attrs = emitElementAttributes(node, component, className, ctx)
  const opening = `<${component}${attrs ? ` ${attrs}` : ''}`
  if (component === 'Input' || component === 'Image' || component === 'Switch') {
    return `${pad}${opening} />`
  }
  const children = node.children.map((child) => emitNode(child, ctx, level + 1)).join('\n')
  const element = children
    ? `${pad}${opening}>\n${children}\n${pad}</${component}>`
    : `${pad}${opening} />`
  if (node.overlay) return `${pad}{${node.overlay.openRef} && (\n${element}\n${pad})}`
  return element
}

function auditElement(node: IRElement, ctx: EmitContext): void {
  const unsupported = [
    node.motion || node.motionDrivers || node.motionScene ? 'motion' : '',
    node.generatedEffect ? 'generated-effect' : '',
    node.prototype || node.transitionKey || node.prototypeTarget ? 'prototype' : '',
    node.rawHtml ? 'raw-html-vector' : '',
    node.module ? 'plugin-module' : '',
    node.icon ? 'lucide-icon' : '',
    node.link ? 'external-link' : '',
    node.upload ? 'upload' : '',
    node.validation || node.formValidationKeys?.length ? 'form-validation' : '',
    node.displayKind ? 'ui-kit-display' : ''
  ].filter(Boolean)
  for (const feature of unsupported) {
    ctx.warn({
      code: `taro-${feature}-unsupported`,
      message: `Taro omitted unsupported ${feature.replaceAll('-', ' ')}`,
      nodeId: node.sourceId
    })
  }
}

function taroComponent(node: IRElement): string {
  if (node.controlKind === 'switch') return 'Switch'
  if (node.controlKind === 'checkbox') return 'Checkbox'
  if (node.controlKind === 'select') return 'Picker'
  if (node.tag === 'input' && node.attrs.type === 'radio') return 'Radio'
  if (node.tag === 'label') return 'Label'
  const mapped = miniProgramElementTag(node)
  const components: Readonly<Record<string, string>> = {
    view: 'View',
    text: 'Text',
    image: 'Image',
    button: 'Button',
    input: 'Input',
    textarea: 'Textarea',
    form: 'Form'
  }
  return components[mapped] ?? 'View'
}

function emitElementAttributes(
  node: IRElement,
  component: string,
  className: string | undefined,
  ctx: EmitContext
): string {
  const attrs: string[] = []
  if (className) attrs.push(`className=${JSON.stringify(className)}`)
  appendStaticAttrs(attrs, node, component, ctx)
  const eventAttributes = emitTaroEventAttributes(node, component, ctx)
  attrs.push(...eventAttributes)
  const imageSource = emitImageSource(node, ctx)
  if (imageSource) attrs.push(imageSource)
  return attrs.join(' ')
}

function appendStaticAttrs(
  attrs: string[],
  node: IRElement,
  component: string,
  ctx: EmitContext
): void {
  const copy: Readonly<Record<string, string>> = {
    disabled: 'disabled',
    max: 'max',
    maxLength: 'maxLength',
    min: 'min',
    name: 'name',
    placeholder: 'placeholder'
  }
  for (const [source, target] of Object.entries(copy)) {
    const value = staticMiniProgramAttr(node.attrs[source])
    if (value !== undefined) attrs.push(`${target}=${JSON.stringify(value)}`)
  }
  const type = staticMiniProgramAttr(node.attrs.type)
  if (component === 'Button' && type === 'submit') attrs.push('formType="submit"')
  else if (
    component === 'Input' &&
    type &&
    ['text', 'number', 'digit', 'password'].includes(type)
  ) {
    attrs.push(`type=${JSON.stringify(type)}`)
  }
  if (node.attrs.style && !styleAttribute(node.attrs.style)) {
    ctx.warn({
      code: 'taro-style-attribute-unsupported',
      message: 'Taro omitted a dynamic style attribute',
      nodeId: node.sourceId
    })
  }
}

function emitImageSource(node: IRElement, ctx: EmitContext): string | undefined {
  if (!node.image) return undefined
  if (node.image.srcExpr) {
    ctx.warn({
      code: 'taro-image-dynamic-source-unsupported',
      message: 'Taro omitted a dynamic image URL because it cannot enforce the export URL policy',
      nodeId: node.sourceId
    })
    return undefined
  }
  const literal = node.image.srcLiteral?.replaceAll('\\', '/')
  if (!literal || !SAFE_IMAGE_SOURCE.test(literal) || literal.split('/').includes('..')) {
    ctx.warn({
      code: 'taro-image-remote-source-unsupported',
      message: 'Taro omitted a non-local image URL',
      nodeId: node.sourceId
    })
    return undefined
  }
  const output = ctx.assets.resolve(literal)
  if (!output) {
    ctx.warn({
      code: 'taro-image-local-source-unavailable',
      message: `Taro could not resolve local image ${JSON.stringify(literal)}`,
      nodeId: node.sourceId
    })
    return undefined
  }
  const sourcePrefix = ctx.componentMode ? '../' : '../../'
  return `src=${JSON.stringify(`${sourcePrefix}${output}`)} mode="aspectFill"`
}

export function createTaroComponentPlans(
  definitions: readonly ComponentDef[]
): ReadonlyMap<string, TaroComponentPlan> {
  const result = new Map<string, TaroComponentPlan>()
  const usedSlugs = new Set<string>()
  const usedIdentifiers = new Set<string>()
  for (const definition of definitions) {
    let slug = stableMiniProgramClassName(definition.componentId).slice(3)
    let suffix = 2
    while (usedSlugs.has(slug)) slug = `${slug}-${suffix++}`
    usedSlugs.add(slug)
    let identifier = safeMiniProgramIdentifier(definition.name, 'GeneratedComponent')
    suffix = 2
    while (usedIdentifiers.has(identifier)) identifier = `${identifier}${suffix++}`
    usedIdentifiers.add(identifier)
    result.set(definition.name, {
      definition,
      identifier,
      propAliases: createTaroComponentPropAliases(definition),
      slug
    })
  }
  return result
}
