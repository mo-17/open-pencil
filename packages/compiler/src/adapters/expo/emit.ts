/* eslint-disable max-lines -- the native target emitter keeps one recursive IR walk in one module */
import type {
  ComponentDef,
  ComponentProp,
  ComponentRefProp,
  IRAttrValue,
  IRComponentRef,
  IRControlledInput,
  IRElement,
  IRNode,
  IRStateDecl,
  IRTree
} from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

import {
  isNativeSwitch as isSwitch,
  isNativeTextInput as isTextInput,
  staticNativeAttr as staticAttr,
  trustedNativeDropdownMenuTrigger,
  trustedNativeModalTrigger,
  trustedNativeSlideMenuTrigger,
  trustedNativeUploadButtonTrigger,
  walkNativeNodes as walkNodes
} from '../native-shared'
import { emitExpoEventHandler, setterName } from './event'
import { translateExpoStyle } from './style'
import type { ExpoStyleResult, ExpoStyleValue, ExpoWarningSink } from './types'

interface EmitEnvironment {
  assetPrefix: string
  componentImportPrefix: string
  devMode: boolean
  nativeAssetNames: ReadonlySet<string>
  router: boolean
  routeRewrites: ReadonlyMap<string, string>
  warn: ExpoWarningSink
}

interface ResolvedEmitEnvironment extends EmitEnvironment {
  componentSymbols: ReadonlyMap<string, string>
  unsupportedListArrays: ReadonlySet<string>
}

interface ElementEnvironment extends ResolvedEmitEnvironment {
  textContext: boolean
  inheritedTextStyle?: Record<string, ExpoStyleValue>
}

const TEXT_TAGS = new Set(['p', 'span', 'label', 'option', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const EXPO_EMITTED_IDENTIFIERS = new Set([
  'Image',
  'ImageBackground',
  'KeyboardAvoidingView',
  'Linking',
  'Platform',
  'Pressable',
  'SafeAreaView',
  'ScrollView',
  'StyleSheet',
  'Switch',
  'Text',
  'TextInput',
  'View',
  'router',
  'styles',
  'useDocState',
  'useLocalSearchParams',
  'useMemo',
  'useRouter',
  'useState'
])
const SAFE_EXTERNAL_LINK_SCHEME = /^(?:https?|mailto|tel):/i
const EXTERNAL_LINK_HELPER = `const __openPencilSafeExternalUrl = /^(?:https?|mailto|tel):/i

function __openPencilOpenExternalUrl(value: unknown): void {
  const url = String(value)
  if (!__openPencilSafeExternalUrl.test(url)) return
  void Linking.canOpenURL(url)
    .then((supported) => (supported ? Linking.openURL(url) : undefined))
    .catch(() => undefined)
}`

export function emitExpoPage(ir: IRTree, exportName: string, environment: EmitEnvironment): string {
  warnPageFeatures(ir, environment.router, environment.warn)
  const unsupportedListArrays = new Set((ir.listQueries ?? []).map((query) => query.rowsName))
  const referencedComponents = referencedComponentNames(ir.children)
  const componentSymbols = allocateComponentSymbols(
    referencedComponents,
    new Set([
      ...EXPO_EMITTED_IDENTIFIERS,
      exportName,
      ...ir.states.flatMap((state) => [state.name, setterName(state.name)]),
      ...ir.docStateReads
    ]),
    ir.pageId,
    environment.warn
  )
  const componentImports = referencedComponents
    .map(
      (name) =>
        `import ${componentSymbols.get(name) ?? name} from '${environment.componentImportPrefix}${name}'`
    )
    .join('\n')
  const docStateActive = ir.docStateReads.length > 0 || ir.docStateWrites.length > 0
  const docStateImport = docStateActive
    ? `import { setDocState, useDocState } from '../runtime/document-state'\n`
    : ''
  const routerImport = environment.router
    ? `import { useLocalSearchParams, useRouter } from 'expo-router'\n`
    : ''
  const stateLines = ir.states.map((state) => emitState(state, 1)).join('\n')
  const docStateLines = ir.docStateReads
    .map((name) => `  const ${name} = useDocState<unknown>(${JSON.stringify(name)})`)
    .join('\n')
  const routerLines = environment.router
    ? [
        '  const router = useRouter()',
        ...(ir.usesRouteParams || ir.usesQueryParams
          ? [
              '  const __routeParams = useLocalSearchParams<Record<string, string | string[]>>()',
              ...(ir.usesRouteParams ? ['  const $params = __routeParams'] : []),
              ...(ir.usesQueryParams ? ['  const $query = __routeParams'] : [])
            ]
          : [])
      ].join('\n')
    : [
        ...(ir.usesRouteParams ? ['  const $params: Record<string, string | string[]> = {}'] : []),
        ...(ir.usesQueryParams ? ['  const $query: Record<string, string | string[]> = {}'] : [])
      ].join('\n')
  const body = ir.children
    .map((node) =>
      emitExpoNode(node, 4, {
        ...environment,
        componentSymbols,
        unsupportedListArrays,
        textContext: false
      })
    )
    .join('\n')
  const declarations = [stateLines, docStateLines, routerLines].filter(Boolean).join('\n')
  const imports = [
    `import { useMemo, useState } from 'react'`,
    `import {\n  Image,\n  ImageBackground,\n  KeyboardAvoidingView,\n  Linking,\n  Platform,\n  Pressable,\n  ScrollView,\n  StyleSheet,\n  Switch,\n  Text,\n  TextInput,\n  View\n} from 'react-native'`,
    `import { SafeAreaView } from 'react-native-safe-area-context'`,
    routerImport.trimEnd(),
    docStateImport.trimEnd(),
    componentImports
  ]
    .filter(Boolean)
    .join('\n')
  return `${imports}\n\n${EXTERNAL_LINK_HELPER}\n\nexport default function ${exportName}() {
${declarations}${declarations ? '\n' : ''}  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.safeArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
${body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { flexGrow: 1, position: 'relative' }
})
`
}

export function emitExpoComponent(definition: ComponentDef, environment: EmitEnvironment): string {
  warnComponentFeatures(definition, environment.warn)
  const unsupportedListArrays = new Set<string>()
  const nodes = componentNodes(definition)
  const referencedComponents = referencedComponentNames(nodes).filter(
    (name) => name !== definition.name
  )
  const props = componentProps(definition)
  const componentSymbols = allocateComponentSymbols(
    referencedComponents,
    new Set([
      ...EXPO_EMITTED_IDENTIFIERS,
      definition.name,
      'style',
      '__content',
      '__variantKey',
      ...props.map((prop) => prop.name),
      ...(definition.docStateReads ?? [])
    ]),
    definition.componentId,
    environment.warn
  )
  const nestedImports = referencedComponents
    .map((name) => `import ${componentSymbols.get(name) ?? name} from './${name}'`)
    .join('\n')
  const docStateReads = definition.docStateReads ?? []
  const docStateActive = docStateReads.length > 0 || (definition.docStateWrites?.length ?? 0) > 0
  const docStateImport = docStateActive
    ? `import { setDocState, useDocState } from '../runtime/document-state'\n`
    : ''
  const propsType = props.map(componentPropType).join('\n')
  const destructured = props.map(componentPropDefault).join(', ')
  const docStateLines = docStateReads
    .map((name) => `  const ${name} = useDocState<unknown>(${JSON.stringify(name)})`)
    .join('\n')
  const routerLine = environment.router ? '  const router = useRouter()' : ''
  const content = definition.variants
    ? emitVariantContent(definition, 1, {
        ...environment,
        componentSymbols,
        unsupportedListArrays
      })
    : definition.children
        .map((node) =>
          emitExpoNode(node, 2, {
            ...environment,
            componentSymbols,
            unsupportedListArrays,
            textContext: false
          })
        )
        .join('\n')
  const imports = [
    `import type { ReactNode } from 'react'`,
    `import type { ImageStyle, StyleProp, TextStyle, ViewStyle } from 'react-native'`,
    `import { Image, ImageBackground, Linking, Pressable, Switch, Text, TextInput, View } from 'react-native'`,
    environment.router ? `import { useRouter } from 'expo-router'` : '',
    docStateImport.trimEnd(),
    nestedImports
  ]
    .filter(Boolean)
    .join('\n')
  const variantBody = definition.variants
    ? `${content}\n  return <View style={style} testID={testID}>{__content}</View>`
    : `  return (\n    <View style={style} testID={testID}>\n${content}\n    </View>\n  )`
  return `${imports}\n\n${EXTERNAL_LINK_HELPER}\n\ninterface ${definition.name}Props {
  style?: StyleProp<ViewStyle>
  testID?: string
${propsType}
}

export default function ${definition.name}({ style, testID${destructured ? `, ${destructured}` : ''} }: ${definition.name}Props) {
${[docStateLines, routerLine].filter(Boolean).join('\n')}${docStateLines || routerLine ? '\n' : ''}${variantBody}
}
`
}

function emitVariantContent(
  definition: ComponentDef,
  indent: number,
  environment: ResolvedEmitEnvironment
): string {
  const pad = '  '.repeat(indent)
  const key = (definition.variantAxes ?? []).map((axis) => axis.name).join(', ')
  const lines = [`${pad}const __variantKey = [${key}].join('|')`, `${pad}let __content: ReactNode`]
  for (const [index, variant] of (definition.variants ?? []).entries()) {
    lines.push(
      `${pad}${index === 0 ? 'if' : 'else if'} (__variantKey === ${JSON.stringify(variant.key)}) {`
    )
    lines.push(...emitVariantFragment(variant.children, indent, environment))
    lines.push(`${pad}}`)
  }
  const fallback = definition.variants?.[0]
  lines.push(`${pad}else {`)
  lines.push(...emitVariantFragment(fallback?.children ?? [], indent, environment))
  lines.push(`${pad}}`)
  return lines.join('\n')
}

function emitVariantFragment(
  nodes: readonly IRNode[],
  indent: number,
  environment: ResolvedEmitEnvironment
): string[] {
  const pad = '  '.repeat(indent)
  return [
    `${pad}  __content = (`,
    `${pad}    <>`,
    ...nodes.map((node) => emitExpoNode(node, indent + 3, { ...environment, textContext: false })),
    `${pad}    </>`,
    `${pad}  )`
  ]
}

function componentProps(definition: ComponentDef): ComponentProp[] {
  const variantProps = (definition.variantAxes ?? []).map<ComponentProp>((axis) => ({
    name: axis.name,
    defaultValue: axis.defaultValue,
    kind: 'variant'
  }))
  return [...definition.props, ...variantProps]
}

function componentPropType(prop: ComponentProp): string {
  if (prop.kind === 'text') return `  ${prop.name}?: string`
  if (prop.kind === 'variant') return `  ${prop.name}?: string`
  return `  ${prop.name}?: StyleProp<ViewStyle | TextStyle | ImageStyle>`
}

function componentPropDefault(prop: ComponentProp): string {
  if (prop.kind === 'text' || prop.kind === 'variant') {
    return `${prop.name} = ${JSON.stringify(prop.defaultValue)}`
  }
  return prop.name
}

function emitExpoNode(node: IRNode, indent: number, environment: ElementEnvironment): string {
  const pad = '  '.repeat(indent)
  if (node.kind === 'text') {
    const value = node.messageId ? node.value : node.value
    const text = escapeJSXText(value)
    const style = inheritedTextStyleAttr(environment)
    return environment.textContext ? `${pad}${text}` : `${pad}<Text${style}>${text}</Text>`
  }
  if (node.kind === 'expression') {
    const expression = emitExpression(node.ast)
    const value = node.fallback ? `${expression} ?? ${JSON.stringify(node.fallback)}` : expression
    const style = inheritedTextStyleAttr(environment)
    return environment.textContext ? `${pad}{${value}}` : `${pad}<Text${style}>{${value}}</Text>`
  }
  if (node.kind === 'conditional') {
    const consequent = emitExpoNode(node.consequent, indent + 1, environment)
    return `${pad}{Boolean(${emitExpression(node.ast)}) && (\n${consequent}\n${pad})}`
  }
  if (node.kind === 'list') {
    if (environment.unsupportedListArrays.has(node.arrayName)) {
      return `${pad}{null /* OpenPencil: Supabase list query omitted in the static Expo target */}`
    }
    const template = emitExpoNode(node.template, indent + 2, environment)
    return `${pad}{${node.arrayName}.map((${node.itemName}, ${node.indexName}) => (\n${pad}  <View key={String(${node.indexName})}>\n${template}\n${pad}  </View>\n${pad}))}`
  }
  if (node.kind === 'componentRef') return emitComponentRef(node, indent, environment)
  return emitElement(node, indent, environment)
}

function emitComponentRef(
  node: IRComponentRef,
  indent: number,
  environment: ElementEnvironment
): string {
  warnMotion(node, environment.warn)
  const style = translateExpoStyle(node.className, node.sourceId, environment.warn).style
  const attrs = [`style={${serializeStyle(style)}}`]
  if (environment.devMode)
    attrs.push(`testID=${JSON.stringify(`openpencil-node-${node.sourceId}`)}`)
  for (const prop of node.props) {
    const emitted = emitComponentRefProp(prop, node.sourceId, environment.warn)
    if (emitted) attrs.push(emitted)
  }
  if (node.events) {
    environment.warn({
      code: 'expo-component-event-unsupported',
      message: `Expo static MVP dropped events on component reference ${node.name}`,
      nodeId: node.sourceId
    })
  }
  const component = environment.componentSymbols.get(node.name) ?? node.name
  return `${'  '.repeat(indent)}<${component} ${attrs.join(' ')} />`
}

function allocateComponentSymbols(
  names: readonly string[],
  reserved: Set<string>,
  nodeId: string,
  warn: ExpoWarningSink
): ReadonlyMap<string, string> {
  const symbols = new Map<string, string>()
  for (const name of names) {
    let symbol = name
    let suffix = 2
    if (reserved.has(symbol)) symbol = `${name}Component`
    while (reserved.has(symbol)) symbol = `${name}Component${suffix++}`
    reserved.add(symbol)
    symbols.set(name, symbol)
    if (symbol !== name) {
      warn({
        code: 'expo-component-import-aliased',
        message: `Expo aliased component import ${JSON.stringify(name)} to ${JSON.stringify(symbol)} to avoid a generated identifier collision`,
        nodeId
      })
    }
  }
  return symbols
}

function emitComponentRefProp(
  prop: ComponentRefProp,
  sourceId: string,
  warn: ExpoWarningSink
): string | undefined {
  if ((prop.kind === 'text' || prop.kind === 'variant') && typeof prop.value === 'string') {
    return `${prop.name}=${JSON.stringify(prop.value)}`
  }
  if (prop.kind === 'className' && typeof prop.value === 'string') {
    const style = translateExpoStyle(prop.value, sourceId, warn).style
    return `${prop.name}={${serializeStyle(style)}}`
  }
  warn({
    code: 'expo-component-style-prop-unsupported',
    message: `Expo static MVP dropped token/CSS style override ${prop.name}`,
    nodeId: sourceId
  })
  return undefined
}

function emitElement(node: IRElement, indent: number, environment: ElementEnvironment): string {
  warnElementFeatures(node, environment.warn)
  const style = translateExpoStyle(node.className, node.sourceId, environment.warn)
  validateBackgroundAsset(style, node.sourceId, environment)
  Object.assign(style.style, nativeInlineStyle(node.attrs.style))
  warnInlineStyle(node.attrs.style, node.sourceId, environment.warn)
  const modalTrigger = trustedNativeModalTrigger(node)
  const dropdownTrigger = trustedNativeDropdownMenuTrigger(node)
  const uploadTrigger = trustedNativeUploadButtonTrigger(node)
  const slideMenuTrigger = trustedNativeSlideMenuTrigger(node)
  const staticModuleTrigger = modalTrigger ?? dropdownTrigger ?? uploadTrigger ?? slideMenuTrigger
  if (staticModuleTrigger !== undefined) {
    warnDroppedEvents(node, new Set(), environment.warn)
    let icon: 'menu' | 'modal' | 'chevron' | 'upload' = 'menu'
    if (modalTrigger) icon = 'modal'
    else if (dropdownTrigger) icon = 'chevron'
    else if (uploadTrigger) icon = 'upload'
    return emitStaticModuleTrigger(node, style, staticModuleTrigger, icon, indent, environment)
  }
  if (node.image) {
    warnDroppedEvents(node, new Set(['onClick']), environment.warn)
    return emitImage(node, style, indent, environment)
  }
  if (isSwitch(node)) {
    warnDroppedEvents(node, new Set(), environment.warn)
    return emitSwitch(node, style, indent, environment)
  }
  if (isTextInput(node)) {
    warnDroppedEvents(node, new Set(), environment.warn)
    return emitTextInput(node, style, indent, environment)
  }
  warnDroppedEvents(node, new Set(['onClick']), environment.warn)
  const component = nativeContainer(node, style)
  return emitContainer(node, component, style, indent, environment)
}

function emitStaticModuleTrigger(
  node: IRElement,
  style: ExpoStyleResult,
  trigger: { label: string; showIcon: boolean; showLabel: boolean },
  icon: 'menu' | 'modal' | 'chevron' | 'upload',
  indent: number,
  environment: ElementEnvironment
): string {
  const pad = '  '.repeat(indent)
  const triggerStyle = { ...style.style }
  triggerStyle.minHeight = Math.max(
    44,
    typeof triggerStyle.minHeight === 'number' ? triggerStyle.minHeight : 0
  )
  triggerStyle.flexDirection = 'row'
  triggerStyle.alignItems = 'center'
  triggerStyle.justifyContent = 'center'
  if (icon === 'upload') triggerStyle.opacity = 0.62
  if (!triggerStyle.backgroundColor && !style.backgroundAsset) {
    triggerStyle.backgroundColor = icon === 'upload' ? '#64748B' : '#2663EB'
  }
  const component = style.backgroundAsset ? 'ImageBackground' : 'View'
  const attrs = [`pointerEvents="none"`]
  if (icon === 'upload') {
    attrs.push(
      `accessible={true}`,
      `accessibilityRole="button"`,
      `accessibilityState={{ disabled: true }}`,
      `accessibilityLabel=${JSON.stringify(trigger.label)}`,
      `accessibilityHint="File selection is unavailable in this static Expo export."`
    )
  }
  attrs.push(`style={${serializeStyle(triggerStyle)}}`)
  if (style.backgroundAsset) {
    attrs.unshift(
      `source={require(${JSON.stringify(`${environment.assetPrefix}${style.backgroundAsset}`)})}`
    )
    attrs.push(`resizeMode=${JSON.stringify(style.resizeMode ?? 'cover')}`)
  }
  if (environment.devMode) {
    attrs.push(`testID=${JSON.stringify(`openpencil-node-${node.sourceId}`)}`)
  }
  const iconStyle = serializeStyle({
    width: 18,
    height: 14,
    justifyContent: 'space-between'
  })
  const lineStyle = serializeStyle({
    width: 18,
    height: 2,
    backgroundColor: '#FFFFFF'
  })
  const labelStyle = serializeStyle({
    ...(trigger.showIcon ? { marginLeft: 8 } : {}),
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1
  })
  const children: string[] = []
  if (trigger.showIcon) {
    let source: string
    if (icon === 'menu') {
      source = `<View style={${iconStyle}}>
  <View style={${lineStyle}} />
  <View style={${lineStyle}} />
  <View style={${lineStyle}} />
</View>`
    } else if (icon === 'modal') {
      source = `<View style={${serializeStyle({
        width: 18,
        height: 16,
        borderColor: '#FFFFFF',
        borderRadius: 2,
        borderWidth: 2
      })}}>
  <View style={${serializeStyle({
    borderTopColor: '#FFFFFF',
    borderTopWidth: 2,
    marginTop: 3
  })}} />
</View>`
    } else if (icon === 'chevron') {
      source = `<View style={${serializeStyle({
        width: 11,
        height: 11,
        borderBottomColor: '#FFFFFF',
        borderBottomWidth: 2,
        borderRightColor: '#FFFFFF',
        borderRightWidth: 2,
        transform: [{ rotate: '45deg' }]
      })}} />`
    } else {
      source = `<View style={${serializeStyle({ width: 18, height: 18 })}}>
  <View style={${serializeStyle({
    position: 'absolute',
    left: 8,
    top: 1,
    width: 2,
    height: 11,
    backgroundColor: '#FFFFFF'
  })}} />
  <View style={${serializeStyle({
    position: 'absolute',
    left: 4,
    top: 1,
    width: 10,
    height: 10,
    borderLeftColor: '#FFFFFF',
    borderLeftWidth: 2,
    borderTopColor: '#FFFFFF',
    borderTopWidth: 2,
    transform: [{ rotate: '45deg' }]
  })}} />
  <View style={${serializeStyle({
    position: 'absolute',
    left: 1,
    bottom: 0,
    width: 16,
    height: 6,
    borderBottomColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderLeftColor: '#FFFFFF',
    borderLeftWidth: 2,
    borderRightColor: '#FFFFFF',
    borderRightWidth: 2
  })}} />
</View>`
    }
    children.push(source)
  }
  if (trigger.showLabel) {
    children.push(
      `<Text numberOfLines={1} ellipsizeMode="tail" style={${labelStyle}}>${escapeJSXText(trigger.label)}</Text>`
    )
  }
  if (icon === 'upload') {
    children.push(
      `<Text style={${serializeStyle({
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '600',
        marginLeft: 8,
        opacity: 0.9
      })}}>Unavailable</Text>`
    )
  }
  const content =
    children.length > 0
      ? `\n${children.map((child) => indentSource(child, indent + 1)).join('\n')}\n${pad}`
      : ''
  return `${pad}<${component} ${attrs.join(' ')}>${content}</${component}>`
}

function indentSource(value: string, depth: number): string {
  const prefix = '  '.repeat(depth)
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function emitImage(
  node: IRElement,
  style: ExpoStyleResult,
  indent: number,
  environment: ElementEnvironment
): string {
  const pad = '  '.repeat(indent)
  const image = node.image
  if (!image) return `${pad}<View />`
  if (image.sources && image.sources.length > 0) {
    environment.warn({
      code: 'expo-responsive-image-unsupported',
      message: 'Expo static MVP uses the fallback image and drops responsive <picture> sources',
      nodeId: node.sourceId
    })
  }
  const source = image.srcExpr
    ? `{ uri: String(${emitExpression(image.srcExpr)}) }`
    : imageSource(image.srcLiteral ?? '', node.sourceId, environment)
  if (!source) return `${pad}<View style={${serializeStyle(style.style)}} />`
  const interactive = Boolean(node.link || (node.events?.onClick?.length ?? 0) > 0)
  const imageElement = nativeImageElement(node, style, source, interactive, environment)
  if (!interactive) return `${pad}${imageElement}`
  const trailing: string[] = []
  if (node.link) trailing.push(linkStatement(node, environment))
  const handler = emitExpoEventHandler(
    node.events?.onClick ?? [],
    {
      router: environment.router,
      routeRewrites: environment.routeRewrites,
      sourceId: node.sourceId,
      warn: environment.warn
    },
    trailing
  )
  const pressableAttrs: string[] = []
  if (handler) pressableAttrs.push(`onPress={${handler}}`)
  pressableAttrs.push(`accessibilityRole=${JSON.stringify(node.link ? 'link' : 'button')}`)
  if (environment.devMode) {
    pressableAttrs.push(`testID=${JSON.stringify(`openpencil-node-${node.sourceId}`)}`)
  }
  return `${pad}<Pressable ${pressableAttrs.join(' ')}>\n${pad}  ${imageElement}\n${pad}</Pressable>`
}

function nativeImageElement(
  node: IRElement,
  style: ExpoStyleResult,
  source: string,
  interactive: boolean,
  environment: ElementEnvironment
): string {
  const attrs = [`source={${source}}`, `style={${serializeStyle(style.style)}}`]
  if (style.resizeMode) attrs.push(`resizeMode=${JSON.stringify(style.resizeMode)}`)
  if (node.image?.alt) attrs.push(`accessibilityLabel=${JSON.stringify(node.image.alt)}`)
  if (environment.devMode && !interactive) {
    attrs.push(`testID=${JSON.stringify(`openpencil-node-${node.sourceId}`)}`)
  }
  return `<Image ${attrs.join(' ')} />`
}

function emitSwitch(
  node: IRElement,
  style: ExpoStyleResult,
  indent: number,
  environment: ElementEnvironment
): string {
  const attrs = [
    `style={${serializeStyle(style.style)}}`,
    ...switchValueAttrs(node.controlled),
    ...(node.attrs.defaultChecked === true ? ['value={true}'] : []),
    ...(node.attrs.disabled === true ? ['disabled'] : []),
    ...(environment.devMode ? [`testID=${JSON.stringify(`openpencil-node-${node.sourceId}`)}`] : [])
  ]
  return `${'  '.repeat(indent)}<Switch ${attrs.join(' ')} />`
}

function switchValueAttrs(controlled: IRControlledInput | undefined): string[] {
  if (!controlled) return []
  const writer = controlledWriter(controlled, 'next')
  return [`value={Boolean(${controlled.read})}`, `onValueChange={(next) => ${writer}}`]
}

function emitTextInput(
  node: IRElement,
  style: ExpoStyleResult,
  indent: number,
  environment: ElementEnvironment
): string {
  const placeholder = staticAttr(node.attrs.placeholder)
  const defaultValue = staticAttr(node.attrs.defaultValue)
  const attrs = [`style={${serializeStyle(style.style)}}`]
  if (placeholder !== undefined) attrs.push(`placeholder=${JSON.stringify(placeholder)}`)
  if (style.placeholderTextColor) {
    attrs.push(`placeholderTextColor=${JSON.stringify(style.placeholderTextColor)}`)
  }
  if (node.tag === 'textarea') attrs.push('multiline')
  if (node.attrs.type === 'number') attrs.push('keyboardType="numeric"')
  if (node.attrs.disabled === true) attrs.push('editable={false}')
  if (node.controlled) attrs.push(...controlledTextAttrs(node.controlled))
  else if (defaultValue !== undefined) {
    attrs.push(`defaultValue=${JSON.stringify(defaultValue)}`)
  }
  if (environment.devMode) {
    attrs.push(`testID=${JSON.stringify(`openpencil-node-${node.sourceId}`)}`)
  }
  return `${'  '.repeat(indent)}<TextInput ${attrs.join(' ')} />`
}

function controlledTextAttrs(controlled: IRControlledInput): string[] {
  const value =
    controlled.write.targetType === 'string' ? controlled.read : `String(${controlled.read} ?? '')`
  const expression = controlled.write.targetType === 'number' ? 'Number(next)' : 'next'
  return [
    `value={${value}}`,
    `onChangeText={(next) => ${controlledWriter(controlled, expression)}}`
  ]
}

function controlledWriter(controlled: IRControlledInput, expression: string): string {
  return controlled.write.kind === 'docState'
    ? `setDocState(${JSON.stringify(controlled.write.name)}, ${expression})`
    : `${setterName(controlled.write.name)}(${expression})`
}

function emitContainer(
  node: IRElement,
  component: 'View' | 'Text' | 'Pressable' | 'ImageBackground',
  style: ExpoStyleResult,
  indent: number,
  environment: ElementEnvironment
): string {
  const pad = '  '.repeat(indent)
  const [containerStyle, inheritedTextStyle] =
    component === 'Pressable' ? splitPressableStyle(style.style) : [style.style, undefined]
  const styleExpression = componentStyleExpression(node, containerStyle)
  const attrs = [`style={${styleExpression}}`]
  if (environment.devMode)
    attrs.push(`testID=${JSON.stringify(`openpencil-node-${node.sourceId}`)}`)
  if (component === 'ImageBackground' && style.backgroundAsset) {
    attrs.unshift(
      `source={require(${JSON.stringify(`${environment.assetPrefix}${style.backgroundAsset}`)})}`
    )
    attrs.push(`resizeMode=${JSON.stringify(style.resizeMode ?? 'cover')}`)
  }
  if (component === 'Pressable') {
    const trailing = node.link ? [linkStatement(node, environment)] : []
    const handler = emitExpoEventHandler(
      node.events?.onClick ?? [],
      {
        router: environment.router,
        routeRewrites: environment.routeRewrites,
        sourceId: node.sourceId,
        warn: environment.warn
      },
      trailing
    )
    if (handler) attrs.push(`onPress={${handler}}`)
    if (node.attrs.disabled === true) attrs.push('disabled')
    attrs.push(`accessibilityRole=${JSON.stringify(node.link ? 'link' : 'button')}`)
  }
  const accessibilityLabel = staticAttr(node.attrs['aria-label'])
  if (accessibilityLabel) attrs.push(`accessibilityLabel=${JSON.stringify(accessibilityLabel)}`)
  const pressableBackground =
    component === 'Pressable' ? emitPressableBackground(style, indent + 1, environment) : undefined
  if ((node.children.length === 0 || node.rawHtml) && !pressableBackground) {
    return `${pad}<${component} ${attrs.join(' ')} />`
  }
  const children = [
    ...(pressableBackground ? [pressableBackground] : []),
    ...node.children.map((child) =>
      emitExpoNode(child, indent + 1, {
        ...environment,
        textContext: component === 'Text',
        inheritedTextStyle
      })
    )
  ].join('\n')
  return `${pad}<${component} ${attrs.join(' ')}>\n${children}\n${pad}</${component}>`
}

function emitPressableBackground(
  style: ExpoStyleResult,
  indent: number,
  environment: ElementEnvironment
): string | undefined {
  if (!style.backgroundAsset) return undefined
  const imageStyle: Record<string, ExpoStyleValue> = {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  }
  const borderRadius = style.style.borderRadius
  if (typeof borderRadius === 'number') imageStyle.borderRadius = borderRadius
  return `${'  '.repeat(indent)}<Image pointerEvents="none" source={require(${JSON.stringify(
    `${environment.assetPrefix}${style.backgroundAsset}`
  )})} resizeMode=${JSON.stringify(style.resizeMode ?? 'cover')} style={${serializeStyle(imageStyle)}} />`
}

function inheritedTextStyleAttr(environment: ElementEnvironment): string {
  return environment.inheritedTextStyle && Object.keys(environment.inheritedTextStyle).length > 0
    ? ` style={${serializeStyle(environment.inheritedTextStyle)}}`
    : ''
}

function splitPressableStyle(
  style: Record<string, ExpoStyleValue>
): [Record<string, ExpoStyleValue>, Record<string, ExpoStyleValue> | undefined] {
  const container: Record<string, ExpoStyleValue> = {}
  const text: Record<string, ExpoStyleValue> = {}
  const textKeys = new Set([
    'color',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'textAlign',
    'textDecorationLine'
  ])
  for (const [key, value] of Object.entries(style)) {
    if (textKeys.has(key)) text[key] = value
    else container[key] = value
  }
  return [container, Object.keys(text).length > 0 ? text : undefined]
}

function componentStyleExpression(node: IRElement, style: Record<string, ExpoStyleValue>): string {
  const base = serializeStyle(style)
  const overrides = [node.classNameProp, node.styleProp].filter(Boolean)
  if (overrides.length === 0) return base
  return `[${base}, ${overrides.join(', ')}]`
}

function nativeContainer(
  node: IRElement,
  style: ExpoStyleResult
): 'View' | 'Text' | 'Pressable' | 'ImageBackground' {
  if (
    node.tag === 'button' ||
    node.tag === 'a' ||
    node.link ||
    (node.events?.onClick?.length ?? 0) > 0
  ) {
    return 'Pressable'
  }
  if (style.backgroundAsset) return 'ImageBackground'
  if (TEXT_TAGS.has(node.tag)) return 'Text'
  return 'View'
}

function linkStatement(node: IRElement, environment: ElementEnvironment): string {
  const href = node.link?.hrefExpr
    ? `String(${emitExpression(node.link.hrefExpr)})`
    : JSON.stringify(node.link?.hrefLiteral ?? '')
  if (node.link?.target && node.link.target !== '_self') {
    environment.warn({
      code: 'expo-link-target-ignored',
      message: `Expo native Linking ignores browser target ${node.link.target}`,
      nodeId: node.sourceId
    })
  }
  const literal = node.link?.hrefLiteral
  if (literal && !SAFE_EXTERNAL_LINK_SCHEME.test(literal)) {
    environment.warn({
      code: 'expo-link-scheme-unsupported',
      message: `Expo blocked external link scheme in ${JSON.stringify(literal)}; only http, https, mailto, and tel are allowed`,
      nodeId: node.sourceId
    })
  }
  return `__openPencilOpenExternalUrl(${href});`
}

function imageSource(
  value: string,
  sourceId: string,
  environment: EmitEnvironment
): string | undefined {
  const local = value.match(/^\.\/assets\/([^/\\]+)$/)
  if (local && environment.nativeAssetNames.has(local[1])) {
    return `require(${JSON.stringify(`${environment.assetPrefix}${local[1]}`)})`
  }
  if (value.startsWith('./assets/')) {
    environment.warn({
      code: 'expo-image-local-source-unavailable',
      message: `Expo dropped local image source ${JSON.stringify(value)} because it is unsafe, unsupported, or not present in the emitted asset set`,
      nodeId: sourceId
    })
    return undefined
  }
  return `{ uri: ${JSON.stringify(value)} }`
}

function validateBackgroundAsset(
  style: ExpoStyleResult,
  sourceId: string,
  environment: EmitEnvironment
): void {
  const name = style.backgroundAsset
  if (!name || environment.nativeAssetNames.has(name)) return
  environment.warn({
    code: 'expo-image-background-unavailable',
    message: `Expo dropped background image ${JSON.stringify(name)} because it is unsupported or not present in the emitted asset set`,
    nodeId: sourceId
  })
  style.backgroundAsset = undefined
}

function warnInlineStyle(
  value: IRAttrValue | undefined,
  sourceId: string,
  warn: ExpoWarningSink
): void {
  if (!value || typeof value !== 'object' || value.kind !== 'styleAttr') return
  const supported = nativeInlineStyle(value)
  if (Object.keys(supported).length === Object.keys(value.declarations).length) return
  warn({
    code: 'expo-css-style-unsupported',
    message:
      'Expo static MVP dropped CSS variable/inline declarations that are not native style values',
    nodeId: sourceId
  })
}

function nativeInlineStyle(value: IRAttrValue | undefined): Record<string, ExpoStyleValue> {
  const style: Record<string, ExpoStyleValue> = {}
  if (!value || typeof value !== 'object' || value.kind !== 'styleAttr') return style
  for (const [key, candidate] of Object.entries(value.declarations)) {
    if (!['backgroundColor', 'color', 'borderColor', 'opacity'].includes(key)) continue
    if (candidate.startsWith('var(')) continue
    style[key] =
      key === 'opacity' && Number.isFinite(Number(candidate)) ? Number(candidate) : candidate
  }
  return style
}

function emitState(state: IRStateDecl, indent: number): string {
  const pad = '  '.repeat(indent)
  if (state.computed) {
    const dependencies = [...new Set(state.computed.references)]
      .map((reference) => (reference.startsWith('$') ? `JSON.stringify(${reference})` : reference))
      .join(', ')
    return `${pad}const ${state.name} = useMemo(() => ${emitExpression(state.computed.ast)}, [${dependencies}])`
  }
  if (state.computedInvalid) return `${pad}const ${state.name} = ${formatDefault(state)}`
  return `${pad}const [${state.name}, ${setterName(state.name)}] = useState(${formatDefault(state)})`
}

function formatDefault(state: IRStateDecl): string {
  const value = state.defaultValue
  if (state.type === 'string') return JSON.stringify(typeof value === 'string' ? value : '')
  if (state.type === 'number')
    return String(typeof value === 'number' && Number.isFinite(value) ? value : 0)
  if (state.type === 'boolean') return value === true ? 'true' : 'false'
  if (state.type === 'array') return JSON.stringify(Array.isArray(value) ? value : [])
  return JSON.stringify(value && typeof value === 'object' ? value : {})
}

function serializeStyle(style: Record<string, ExpoStyleValue>): string {
  return JSON.stringify(style)
}

function componentNodes(definition: ComponentDef): IRNode[] {
  return definition.variants
    ? [...definition.children, ...definition.variants.flatMap((variant) => variant.children)]
    : definition.children
}

function referencedComponentNames(nodes: readonly IRNode[]): string[] {
  const names = new Set<string>()
  walkNodes(nodes, (node) => {
    if (node.kind === 'componentRef') names.add(node.name)
  })
  return [...names].sort()
}

function warnPageFeatures(ir: IRTree, router: boolean, warn: ExpoWarningSink): void {
  if (ir.requiresAuth) warnFeature(warn, 'expo-auth-guard-unsupported', 'auth guard', ir.pageId)
  if ((ir.listQueries?.length ?? 0) > 0)
    warnFeature(warn, 'expo-list-query-unsupported', 'Supabase list query', ir.pageId)
  if ((ir.validatedFields?.length ?? 0) > 0)
    warnFeature(warn, 'expo-validation-unsupported', 'form validation runtime', ir.pageId)
  if (ir.supabaseConfig)
    warnFeature(warn, 'expo-supabase-unsupported', 'Supabase runtime', ir.pageId)
  if (ir.analyticsConfig)
    warnFeature(warn, 'expo-analytics-unsupported', 'analytics runtime', ir.pageId)
  if ((ir.serverWorkflows?.length ?? 0) > 0)
    warnFeature(warn, 'expo-server-workflow-unsupported', 'server workflow client', ir.pageId)
  for (const state of ir.docStates) {
    if (state.persist)
      warnFeature(
        warn,
        'expo-persistence-unsupported',
        `persisted document state ${state.name}`,
        ir.pageId
      )
  }
  if (!router && (ir.routePattern || ir.usesRouteParams || ir.usesQueryParams)) {
    warnFeature(
      warn,
      'expo-route-runtime-unsupported',
      'route pattern/parameter behavior because Expo Router is disabled',
      ir.pageId
    )
  }
  warnMotion(ir, warn)
}

function warnComponentFeatures(definition: ComponentDef, warn: ExpoWarningSink): void {
  if ((definition.validatedFields?.length ?? 0) > 0) {
    warnFeature(
      warn,
      'expo-validation-unsupported',
      'component validation runtime',
      definition.componentId
    )
  }
}

function warnElementFeatures(node: IRElement, warn: ExpoWarningSink): void {
  if (node.module)
    warnFeature(
      warn,
      'expo-module-unsupported',
      `${node.module.pluginId}/${node.module.moduleType} module`,
      node.sourceId
    )
  if (node.rawHtml)
    warnFeature(warn, 'expo-vector-unsupported', 'raw SVG/vector HTML', node.sourceId)
  if (node.upload)
    warnFeature(warn, 'expo-upload-unsupported', 'browser file upload', node.sourceId)
  if (node.overlay)
    warnFeature(
      warn,
      'expo-overlay-unsupported',
      `${node.overlay.kind} overlay behavior`,
      node.sourceId
    )
  if (node.icon)
    warnFeature(warn, 'expo-icon-unsupported', `lucide icon ${node.icon.name}`, node.sourceId)
  if (node.generatedEffect)
    warnFeature(warn, 'expo-generated-effect-unsupported', 'generated visual effect', node.sourceId)
  if (node.validation || node.formValidationKeys)
    warnFeature(warn, 'expo-validation-unsupported', 'form validation behavior', node.sourceId)
  if (
    node.controlKind === 'select' ||
    node.controlKind === 'radio-group' ||
    node.controlKind === 'checkbox-group'
  ) {
    warnFeature(warn, 'expo-control-unsupported', `${node.controlKind} control`, node.sourceId)
  }
  warnMotion(node, warn)
}

function warnDroppedEvents(
  node: IRElement,
  supported: ReadonlySet<string>,
  warn: ExpoWarningSink
): void {
  for (const eventName of Object.keys(node.events ?? {}).sort()) {
    if (supported.has(eventName)) continue
    warn({
      code: 'expo-event-unsupported',
      message: `Expo static MVP dropped ${eventName} behavior`,
      nodeId: node.sourceId
    })
  }
}

function warnMotion(
  node:
    | Pick<IRElement, 'sourceId' | 'motion' | 'motionDrivers' | 'motionScene'>
    | Pick<IRComponentRef, 'sourceId' | 'motion' | 'motionDrivers'>
    | Pick<IRTree, 'pageId' | 'motion' | 'motionDrivers' | 'motionScene'>,
  warn: ExpoWarningSink
): void {
  if (!node.motion && !node.motionDrivers && !('motionScene' in node && node.motionScene)) return
  warnFeature(
    warn,
    'expo-motion-unsupported',
    'DOM/CSS motion behavior',
    'sourceId' in node ? node.sourceId : node.pageId
  )
}

function warnFeature(warn: ExpoWarningSink, code: string, feature: string, nodeId: string): void {
  warn({
    code,
    message: `Expo static MVP emitted a static native fallback and dropped ${feature}`,
    nodeId
  })
}

function escapeJSXText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;')
}
