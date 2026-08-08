/* eslint-disable max-lines -- one recursive IR-to-Widget walk keeps Flutter emission coherent */
import type {
  ComponentDef,
  IRComponentRef,
  IRControlledInput,
  IRElement,
  IREventHandler,
  IRNode,
  IRStateDecl,
  IRTree
} from '#compiler/ir/types'

import { lowcodeNavigationPathname } from '@open-pencil/core/lowcode-validation'

import {
  isNativeSwitch as isSwitch,
  isNativeTextInput as isTextInput,
  safeNativeStateDefault,
  staticNativeAttr as staticAttr,
  walkNativeNodes as walkNodes
} from '../native-shared'
import { dartLiteral, emitDartCondition, emitDartExpression } from './expression'
import { allocateDartIdentifier, dartIdentifier, dartString } from './names'
import {
  boxConstraints,
  boxDecoration,
  boxFit,
  edgeInsets,
  flutterColor,
  textAlign,
  textStyle,
  translateFlutterStyle
} from './style'
import type { FlutterComponentPlan, FlutterStyle, FlutterWarningSink } from './types'

export interface FlutterEmitEnvironment {
  componentBody?: boolean
  componentPlans: ReadonlyMap<string, FlutterComponentPlan>
  devMode: boolean
  nativeAssetAliases: ReadonlyMap<string, string>
  nativeAssetNames: ReadonlySet<string>
  routeRewrites: ReadonlyMap<string, string>
  router: boolean
  warn: FlutterWarningSink
}

interface NodeEnvironment extends FlutterEmitEnvironment {
  listDepth?: number
  names: ReadonlyMap<string, string>
  sourceId: string
  unsupportedListArrays: ReadonlySet<string>
  inheritedTextStyle?: FlutterStyle
  supportsLocalState: boolean
}

const TEXT_TAGS = new Set(['p', 'span', 'label', 'option', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

export function emitFlutterPage(
  ir: IRTree,
  className: string,
  environment: FlutterEmitEnvironment
): string {
  warnPageFeatures(ir, environment.warn)
  const names = allocatePageNames(ir, environment.router)
  const stateFields = ir.states.map((state) =>
    emitStateField(state, names, ir.pageId, environment.warn)
  )
  const docReads = ir.docStateReads.map(
    (name) =>
      `final ${names.get(name)} = OpenPencilDocumentState.instance.getValue(${dartString(name)});`
  )
  const nodeEnvironment: NodeEnvironment = {
    ...environment,
    names,
    sourceId: ir.pageId,
    supportsLocalState: true,
    unsupportedListArrays: new Set((ir.listQueries ?? []).map((query) => query.rowsName))
  }
  const body = emitChildrenLayout(ir.children, nodeEnvironment)
  const constructor = environment.router
    ? `  const ${className}({
    super.key,
    this.routeParams = const <String, String>{},
    this.queryParams = const <String, String>{},
  });

  final Map<String, String> routeParams;
  final Map<String, String> queryParams;`
    : `  const ${className}({super.key});`
  return `import 'package:flutter/material.dart';

import '../openpencil_runtime.dart';
${componentImports(ir.children, environment.componentPlans)}

class ${className} extends StatefulWidget {
${constructor}

  @override
  State<${className}> createState() => _${className}State();
}

class _${className}State extends State<${className}> {
${indent(stateFields.join('\n'), 1)}

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: AnimatedBuilder(
          animation: OpenPencilDocumentState.instance,
          builder: (context, _) {
${indent(docReads.join('\n'), 6)}
            return SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              child: ${indent(body, 7).trimStart()},
            );
          },
        ),
      ),
    );
  }
}
`
}

export function emitFlutterComponent(
  definition: ComponentDef,
  plan: FlutterComponentPlan,
  environment: FlutterEmitEnvironment
): string {
  if (definition.variants && definition.variants.length > 0) {
    environment.warn({
      code: 'flutter-component-variants-static-fallback',
      message: `Flutter static MVP emitted the first variant of component ${JSON.stringify(definition.name)}`,
      nodeId: definition.componentId
    })
  }
  const props = [...definition.props, ...(definition.variantAxes ?? [])]
  const names = new Map(plan.propNames)
  const used = new Set(['context', 'key', ...names.values()])
  for (const name of definition.docStateReads ?? []) {
    if (!names.has(name)) {
      names.set(name, allocateDartIdentifier(`op-document-${name}`, used, 'opDocumentValue'))
    }
  }
  const children = definition.variants?.[0]?.children ?? definition.children
  const body = emitChildrenLayout(children, {
    ...environment,
    names,
    sourceId: definition.componentId,
    componentBody: true,
    supportsLocalState: false,
    unsupportedListArrays: new Set()
  })
  const fields = props.map((prop) => `  final String ${names.get(prop.name)};`).join('\n')
  const parameters = props
    .map((prop) => {
      return `    this.${names.get(prop.name)} = ${dartString(prop.defaultValue)},`
    })
    .join('\n')
  const docReads = (definition.docStateReads ?? []).map(
    (name) =>
      `final ${names.get(name)} = OpenPencilDocumentState.instance.getValue(${dartString(name)});`
  )
  return `import 'package:flutter/material.dart';

import '../openpencil_runtime.dart';

class ${plan.className} extends StatelessWidget {
  const ${plan.className}({
    super.key,
${parameters}
  });

${fields}

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: OpenPencilDocumentState.instance,
      builder: (context, _) {
${indent(docReads.join('\n'), 4)}
        return ${indent(body, 4).trimStart()};
      },
    );
  }
}
`
}

function allocatePageNames(ir: IRTree, router: boolean): ReadonlyMap<string, string> {
  const used = new Set([
    'context',
    'entry',
    'next',
    'openPencilItems',
    'widget',
    'build',
    'setState',
    'previous',
    'OpenPencilRuntime',
    'OpenPencilDocumentState'
  ])
  const names = new Map<string, string>([
    ['$params', router ? 'widget.routeParams' : 'const <String, String>{}'],
    ['$query', router ? 'widget.queryParams' : 'const <String, String>{}']
  ])
  for (const state of ir.states) {
    names.set(state.name, allocateDartIdentifier(`op-state-${state.name}`, used, 'opStateValue'))
  }
  for (const name of [...ir.docStateReads, ...ir.docStateWrites]) {
    if (!names.has(name)) {
      names.set(name, allocateDartIdentifier(`op-document-${name}`, used, 'opDocumentValue'))
    }
  }
  return names
}

function emitStateField(
  state: IRStateDecl,
  names: ReadonlyMap<string, string>,
  sourceId: string,
  warn: FlutterWarningSink
): string {
  const name = names.get(state.name) ?? dartIdentifier(state.name, 'stateValue')
  if (state.computed) {
    return `dynamic get ${name} => ${emitDartExpression(state.computed.ast, { names, sourceId, warn })};`
  }
  return `dynamic ${name} = ${dartLiteral(safeNativeStateDefault(state))};`
}

function emitNode(node: IRNode, environment: NodeEnvironment): string {
  if (node.kind === 'text') {
    return textWidget(dartString(node.value), environment.inheritedTextStyle)
  }
  if (node.kind === 'expression') {
    const value = emitDartExpression(node.ast, expressionContext(node, environment))
    const fallback = node.fallback ? ` ?? ${dartString(node.fallback)}` : ''
    return textWidget(`OpenPencilRuntime.text(${value}${fallback})`, environment.inheritedTextStyle)
  }
  if (node.kind === 'conditional') {
    return `${emitDartCondition(node.ast, expressionContext(node, environment))} ? ${emitNode(
      node.consequent,
      environment
    )} : const SizedBox.shrink()`
  }
  if (node.kind === 'list') return emitList(node, environment)
  if (node.kind === 'componentRef') return emitComponentRef(node, environment)
  return emitElement(node, environment)
}

function emitList(node: Extract<IRNode, { kind: 'list' }>, environment: NodeEnvironment): string {
  if (environment.unsupportedListArrays.has(node.arrayName)) {
    environment.warn({
      code: 'flutter-list-query-unsupported',
      message: 'Flutter static MVP omitted a Supabase-backed LIST query',
      nodeId: environment.sourceId
    })
    return 'const SizedBox.shrink()'
  }
  const depth = (environment.listDepth ?? 0) + 1
  const suffix = depth === 1 ? '' : String(depth)
  const items = `openPencilItems${suffix}`
  const entry = `openPencilEntry${suffix}`
  const names = new Map(environment.names)
  names.set(node.itemName, `${entry}.value`)
  names.set(node.indexName, `${entry}.key`)
  const array = environment.names.get(node.arrayName)
  if (!array) {
    environment.warn({
      code: 'flutter-list-source-unavailable',
      message: `Flutter static MVP omitted LIST source ${JSON.stringify(node.arrayName)}`,
      nodeId: environment.sourceId
    })
    return 'const SizedBox.shrink()'
  }
  const template = emitNode(node.template, { ...environment, listDepth: depth, names })
  return `Builder(
  builder: (context) {
    final ${items} = OpenPencilRuntime.list(${array});
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: ${items}.asMap().entries.map((${entry}) {
        return ${indent(template, 4).trimStart()};
      }).toList(),
    );
  },
)`
}

function emitComponentRef(node: IRComponentRef, environment: NodeEnvironment): string {
  if (environment.componentBody) {
    environment.warn({
      code: 'flutter-nested-component-reference-unsupported',
      message: `Flutter omitted nested component reference ${JSON.stringify(node.name)} to prevent recursive or cyclic Widget construction`,
      nodeId: node.sourceId
    })
    return 'const SizedBox.shrink()'
  }
  const plan = environment.componentPlans.get(node.name)
  if (!plan) {
    environment.warn({
      code: 'flutter-component-reference-unavailable',
      message: `Flutter omitted unresolved component reference ${JSON.stringify(node.name)}`,
      nodeId: node.sourceId
    })
    return 'const SizedBox.shrink()'
  }
  if (node.events) {
    environment.warn({
      code: 'flutter-component-event-unsupported',
      message: `Flutter dropped events on component reference ${JSON.stringify(node.name)}`,
      nodeId: node.sourceId
    })
  }
  const props = node.props.flatMap((prop) => {
    const emittedName = plan.propNames.get(prop.name)
    if (
      !emittedName ||
      (prop.kind !== 'text' && prop.kind !== 'variant') ||
      typeof prop.value !== 'string'
    ) {
      environment.warn({
        code: 'flutter-component-style-prop-unsupported',
        message: `Flutter dropped component override ${JSON.stringify(prop.name)}`,
        nodeId: node.sourceId
      })
      return []
    }
    return [`${emittedName}: ${dartString(prop.value)}`]
  })
  let widget = `${plan.importAlias}.${plan.className}(${props.join(', ')})`
  const style = translateFlutterStyle(node.className, node.sourceId, environment.warn)
  widget = wrapStyle(widget, style)
  return widget
}

function emitElement(node: IRElement, environment: NodeEnvironment): string {
  warnElementFeatures(node, environment.warn)
  const style = translateFlutterStyle(node.className, node.sourceId, environment.warn)
  if (style.backgroundAsset) {
    const resolved = environment.nativeAssetAliases.get(style.backgroundAsset)
    if (resolved) style.backgroundAsset = resolved
  }
  if (style.backgroundAsset && !environment.nativeAssetNames.has(style.backgroundAsset)) {
    environment.warn({
      code: 'flutter-image-background-unavailable',
      message: `Flutter dropped unavailable background image ${JSON.stringify(style.backgroundAsset)}`,
      nodeId: node.sourceId
    })
    style.backgroundAsset = undefined
  }
  let widget: string
  if (unsupportedControl(node)) {
    environment.warn({
      code: 'flutter-form-control-unsupported',
      message: `Flutter omitted unsupported ${unsupportedControlLabel(node)} control instead of emitting misleading behavior`,
      nodeId: node.sourceId
    })
    widget = 'const SizedBox.shrink()'
  } else if (node.image) widget = emitImage(node, style, environment)
  else if (isSwitch(node)) widget = emitSwitch(node, environment)
  else if (isTextInput(node)) widget = emitTextInput(node, style, environment)
  else if (node.tag === 'button') widget = emitButton(node, style, environment)
  else if (TEXT_TAGS.has(node.tag)) widget = emitTextElement(node, style, environment)
  else widget = emitContainer(node, style, environment)
  widget = wrapStyle(widget, style)
  const label = staticAttr(node.attrs['aria-label'])
  if (label) widget = `Semantics(label: ${dartString(label)}, child: ${widget})`
  if (environment.devMode) {
    widget = `KeyedSubtree(key: ValueKey(${dartString(`openpencil-node-${node.sourceId}`)}), child: ${widget})`
  }
  return widget
}

function emitImage(node: IRElement, style: FlutterStyle, environment: NodeEnvironment): string {
  if (node.image?.sources?.length) {
    environment.warn({
      code: 'flutter-responsive-image-unsupported',
      message: 'Flutter static MVP dropped responsive image sources and used only the fallback',
      nodeId: node.sourceId
    })
  }
  const fit = boxFit(style.imageFit)
  const alt = node.image?.alt ? `, semanticLabel: ${dartString(node.image.alt)}` : ''
  if (node.image?.srcExpr) {
    return `OpenPencilRuntime.safeNetworkImage(${emitDartExpression(
      node.image.srcExpr,
      expressionContext(node, environment)
    )}, fit: ${fit}${alt})`
  }
  const source = node.image?.srcLiteral ?? ''
  const local = /^\.\/assets\/([^/\\]+)$/.exec(source)?.[1]
  const resolvedLocal = local ? environment.nativeAssetAliases.get(local) : undefined
  if (resolvedLocal && environment.nativeAssetNames.has(resolvedLocal)) {
    return `Image.asset(${dartString(`assets/images/${resolvedLocal}`)}, fit: ${fit}${alt})`
  }
  if (source.startsWith('./assets/')) {
    environment.warn({
      code: 'flutter-image-local-source-unavailable',
      message: `Flutter dropped unsafe or unavailable local image ${JSON.stringify(source)}`,
      nodeId: node.sourceId
    })
    return 'const SizedBox.shrink()'
  }
  if (source && !safeRemoteImageUrl(source)) {
    environment.warn({
      code: 'flutter-image-url-scheme-unsupported',
      message: `Flutter blocked remote image URL ${JSON.stringify(source)}; only credential-free HTTPS URLs with a host are allowed`,
      nodeId: node.sourceId
    })
    return 'const SizedBox.shrink()'
  }
  return `OpenPencilRuntime.safeNetworkImage(${dartString(source)}, fit: ${fit}${alt})`
}

function emitSwitch(node: IRElement, environment: NodeEnvironment): string {
  const controlled = node.controlled
  const arrayControlled = controlled?.write.targetType === 'array'
  if (arrayControlled) {
    environment.warn({
      code: 'flutter-checkbox-array-unsupported',
      message:
        'Flutter omitted array checkbox value semantics because an option toggle cannot be inferred safely',
      nodeId: node.sourceId
    })
  }
  const read = controlled ? controlledRead(controlled, environment) : undefined
  let value = node.attrs.defaultChecked === true ? 'true' : 'false'
  if (read && !arrayControlled) value = `OpenPencilRuntime.truthy(${read})`
  let change = 'null'
  if (node.attrs.disabled !== true && controlled && read && !arrayControlled) {
    const expression = controlled.write.targetType === 'boolean' ? 'next ?? false' : 'next'
    const write = controlledWrite(controlled, expression, environment)
    if (write) change = `(next) { ${write} }`
  }
  return node.controlKind === 'switch'
    ? `Switch(value: ${value}, onChanged: ${change})`
    : `Checkbox(value: ${value}, onChanged: ${change})`
}

function emitTextInput(node: IRElement, style: FlutterStyle, environment: NodeEnvironment): string {
  const placeholder = staticAttr(node.attrs.placeholder)
  const controlled = node.controlled
  const value = controlled ? controlledRead(controlled, environment) : undefined
  const defaultValue = controlled ? undefined : staticAttr(node.attrs.defaultValue)
  const write = controlled
    ? controlledWrite(controlled, inputValue(controlled, 'next'), environment)
    : undefined
  let initialValue = ''
  if (value) initialValue = `initialValue: OpenPencilRuntime.text(${value}),`
  else if (defaultValue !== undefined) initialValue = `initialValue: ${dartString(defaultValue)},`
  const decoration = `InputDecoration(${[
    placeholder ? `hintText: ${dartString(placeholder)}` : '',
    style.placeholderColor
      ? `hintStyle: TextStyle(color: ${flutterColor(style.placeholderColor)})`
      : ''
  ]
    .filter(Boolean)
    .join(', ')})`
  return `TextFormField(
  ${initialValue}
  decoration: ${decoration},
  ${textStyle(style) ? `style: ${textStyle(style)},` : ''}
  ${node.tag === 'textarea' ? 'maxLines: null,' : ''}
  ${node.attrs.type === 'number' ? 'keyboardType: TextInputType.number,' : ''}
  enabled: ${node.attrs.disabled === true ? 'false' : 'true'},
  ${controlled && value && write ? `onChanged: (next) { ${write} },` : ''}
)`
}

function emitButton(node: IRElement, style: FlutterStyle, environment: NodeEnvironment): string {
  const handler = emitEventBody(node.events?.onClick ?? [], node.sourceId, environment)
  const child = emitChildrenLayout(node.children, { ...environment, inheritedTextStyle: style })
  return `TextButton(
  onPressed: ${node.attrs.disabled === true ? 'null' : `() { ${handler} }`},
  child: ${child},
)`
}

function emitTextElement(
  node: IRElement,
  style: FlutterStyle,
  environment: NodeEnvironment
): string {
  const content = inlineText(node.children, environment)
  if (content) return textWidget(content, style)
  return emitChildrenLayout(node.children, { ...environment, inheritedTextStyle: style })
}

function emitContainer(node: IRElement, style: FlutterStyle, environment: NodeEnvironment): string {
  const child = emitChildrenLayout(node.children, environment, style)
  const click = emitEventBody(node.events?.onClick ?? [], node.sourceId, environment)
  if (click) return `InkWell(onTap: () { ${click} }, child: ${child})`
  return child
}

function emitChildrenLayout(
  nodes: readonly IRNode[],
  environment: NodeEnvironment,
  style: FlutterStyle = {}
): string {
  if (nodes.length === 0) return 'const SizedBox.shrink()'
  const absolute = nodes.some(nodeIsPositioned)
  const children = nodes.map((node) => emitNode(node, environment))
  if (absolute) {
    const height = Math.max(1, ...nodes.map(estimatedBottom))
    return `SizedBox(
  width: double.infinity,
  height: ${dartDouble(height)},
  child: Stack(clipBehavior: Clip.none, children: [
${indent(children.map((child) => `${child},`).join('\n'), 2)}
  ]),
)`
  }
  const gap = style.gap ?? 0
  const separated =
    gap > 0
      ? intersperse(
          children,
          `const SizedBox(${style.flexDirection === 'row' ? 'width' : 'height'}: ${gap}),`
        )
      : children
  const axis = style.flexDirection === 'row' ? 'Row' : 'Column'
  const main = style.mainAxisAlignment
    ? `mainAxisAlignment: MainAxisAlignment.${style.mainAxisAlignment},`
    : ''
  let cross = ''
  if (style.crossAxisAlignment) {
    cross = `crossAxisAlignment: CrossAxisAlignment.${style.crossAxisAlignment},`
  } else if (axis === 'Column') {
    cross = 'crossAxisAlignment: CrossAxisAlignment.stretch,'
  }
  return `${axis}(
  ${main}
  ${cross}
  mainAxisSize: MainAxisSize.min,
  children: [
${indent(separated.map((child) => (child.endsWith(',') ? child : `${child},`)).join('\n'), 2)}
  ],
)`
}

function wrapStyle(child: string, style: FlutterStyle): string {
  const args = [
    style.width !== undefined ? `width: ${style.width}` : '',
    style.height !== undefined ? `height: ${style.height}` : '',
    edgeInsets(style.margin) ? `margin: ${edgeInsets(style.margin)}` : '',
    edgeInsets(style.padding) ? `padding: ${edgeInsets(style.padding)}` : '',
    boxConstraints(style) ? `constraints: ${boxConstraints(style)}` : '',
    boxDecoration(style, 'assets/images/')
      ? `decoration: ${boxDecoration(style, 'assets/images/')}`
      : ''
  ].filter(Boolean)
  let value = args.length > 0 ? `Container(${args.join(', ')}, child: ${child})` : child
  if (style.opacity !== undefined) value = `Opacity(opacity: ${style.opacity}, child: ${value})`
  if (style.position === 'absolute') {
    const position = [
      style.left !== undefined ? `left: ${style.left}` : '',
      style.top !== undefined ? `top: ${style.top}` : '',
      style.right !== undefined ? `right: ${style.right}` : '',
      style.bottom !== undefined ? `bottom: ${style.bottom}` : ''
    ]
      .filter(Boolean)
      .join(', ')
    value = `Positioned(${position ? `${position}, ` : ''}child: ${value})`
  }
  return value
}

function emitEventBody(
  handlers: readonly IREventHandler[],
  sourceId: string,
  environment: NodeEnvironment
): string {
  return handlers.flatMap((handler) => emitHandler(handler, sourceId, environment)).join(' ')
}

function emitHandler(
  handler: IREventHandler,
  sourceId: string,
  environment: NodeEnvironment
): string[] {
  const context = { names: environment.names, sourceId, warn: environment.warn }
  if (handler.kind === 'setState') return emitStateHandler(handler, sourceId, environment, context)
  if (handler.kind === 'setVariable') return emitVariableHandler(handler, context)
  if (handler.kind === 'navigate') {
    if (!environment.router) {
      environment.warn({
        code: 'flutter-navigate-router-required',
        message: `Flutter dropped navigate(${JSON.stringify(handler.to)}) because router is disabled`,
        nodeId: sourceId
      })
      return []
    }
    const pathname = lowcodeNavigationPathname(handler.to)
    const suffix = handler.to.slice(pathname.length)
    const route = `${environment.routeRewrites.get(pathname) ?? pathname}${suffix}`
    const params = handler.params?.map(
      (param) => `${dartString(param.name)}: ${emitDartExpression(param.ast, context)}`
    )
    const destination = params?.length
      ? `OpenPencilRuntime.route(${dartString(route)}, <String, dynamic>{${params.join(', ')}})`
      : dartString(route)
    return [`Navigator.of(context).pushNamed(${destination});`]
  }
  if (handler.kind === 'condition') {
    const consequent = handler.consequent.flatMap((item) =>
      emitHandler(item, sourceId, environment)
    )
    const alternate = (handler.alternate ?? []).flatMap((item) =>
      emitHandler(item, sourceId, environment)
    )
    if (consequent.length === 0 && alternate.length === 0) return []
    return [
      `if (${emitDartCondition(handler.condAst, context)}) { ${consequent.join(' ')} }${
        alternate.length ? ` else { ${alternate.join(' ')} }` : ''
      }`
    ]
  }
  if (handler.kind === 'stop') return ['return;']
  environment.warn({
    code: 'flutter-action-unsupported',
    message: `Flutter static MVP dropped ${handler.kind} action`,
    nodeId: sourceId
  })
  return []
}

function emitStateHandler(
  handler: Extract<IREventHandler, { kind: 'setState' }>,
  sourceId: string,
  environment: NodeEnvironment,
  context: { names: ReadonlyMap<string, string>; sourceId: string; warn: FlutterWarningSink }
): string[] {
  if (!environment.supportsLocalState) {
    environment.warn({
      code: 'flutter-component-local-state-action-unsupported',
      message: 'Flutter dropped a page-state action from a stateless component body',
      nodeId: sourceId
    })
    return []
  }
  const name = environment.names.get(handler.stateName)
  if (!name) {
    environment.warn({
      code: 'flutter-state-target-unavailable',
      message: `Flutter dropped setState for unavailable state ${JSON.stringify(handler.stateName)}`,
      nodeId: sourceId
    })
    return []
  }
  const expression = emitDartExpression(
    handler.ast,
    handler.mode === 'functional' ? functionalContext(context) : context
  )
  return handler.mode === 'functional'
    ? [`setState(() { final previous = ${name}; ${name} = ${expression}; });`]
    : [`setState(() { ${name} = ${expression}; });`]
}

function emitVariableHandler(
  handler: Extract<IREventHandler, { kind: 'setVariable' }>,
  context: { names: ReadonlyMap<string, string>; sourceId: string; warn: FlutterWarningSink }
): string[] {
  const expression = emitDartExpression(
    handler.ast,
    handler.mode === 'functional' ? functionalContext(context) : context
  )
  return handler.mode === 'functional'
    ? [
        `OpenPencilDocumentState.instance.updateValue(${dartString(handler.docStateName)}, (previous) => ${expression});`
      ]
    : [
        `OpenPencilDocumentState.instance.setValue(${dartString(handler.docStateName)}, ${expression});`
      ]
}

function functionalContext(context: {
  names: ReadonlyMap<string, string>
  sourceId: string
  warn: FlutterWarningSink
}) {
  const names = new Map(context.names)
  names.set('prev', 'previous')
  return { ...context, names }
}

function controlledWrite(
  controlled: IRControlledInput,
  expression: string,
  environment: NodeEnvironment
): string | undefined {
  if (controlled.write.kind === 'docState') {
    return `OpenPencilDocumentState.instance.setValue(${dartString(controlled.write.name)}, ${expression});`
  }
  const name = environment.names.get(controlled.write.name)
  if (name) return `setState(() { ${name} = ${expression}; });`
  environment.warn({
    code: 'flutter-controlled-state-target-unavailable',
    message: `Flutter disabled a controlled input writer for unavailable state ${JSON.stringify(controlled.write.name)}`,
    nodeId: environment.sourceId
  })
  return undefined
}

function controlledRead(
  controlled: IRControlledInput,
  environment: NodeEnvironment
): string | undefined {
  const name = environment.names.get(controlled.read)
  if (name) return name
  environment.warn({
    code: 'flutter-controlled-state-read-unavailable',
    message: `Flutter disabled a controlled input reader for unavailable state ${JSON.stringify(controlled.read)}`,
    nodeId: environment.sourceId
  })
  return undefined
}

function inputValue(controlled: IRControlledInput, value: string): string {
  if (controlled.write.targetType === 'number') return `OpenPencilRuntime.number(${value})`
  if (controlled.write.targetType === 'boolean') return `OpenPencilRuntime.truthy(${value})`
  return value
}

function inlineText(nodes: readonly IRNode[], environment: NodeEnvironment): string | undefined {
  if (!nodes.every((node) => node.kind === 'text' || node.kind === 'expression')) return undefined
  const parts = nodes.map((node) =>
    node.kind === 'text'
      ? dartString(node.value)
      : `OpenPencilRuntime.text(${emitDartExpression(node.ast, expressionContext(node, environment))}${
          node.fallback ? ` ?? ${dartString(node.fallback)}` : ''
        })`
  )
  return parts.join(' + ') || "''"
}

function textWidget(value: string, style: FlutterStyle | undefined): string {
  const textStyleValue = style ? textStyle(style) : undefined
  const align = style ? textAlign(style) : undefined
  return `Text(${value}${textStyleValue ? `, style: ${textStyleValue}` : ''}${align ? `, textAlign: ${align}` : ''})`
}

function expressionContext(_node: unknown, environment: NodeEnvironment) {
  return {
    names: environment.names,
    sourceId: environment.sourceId,
    warn: environment.warn
  }
}

function componentImports(
  nodes: readonly IRNode[],
  plans: ReadonlyMap<string, FlutterComponentPlan>
): string {
  const names = new Set<string>()
  walkNodes(nodes, (node) => {
    if (node.kind === 'componentRef') names.add(node.name)
  })
  return [...names]
    .sort()
    .flatMap((name) => {
      const plan = plans.get(name)
      return plan ? [`import '../components/${plan.fileName}' as ${plan.importAlias};`] : []
    })
    .join('\n')
}

function nodeIsPositioned(node: IRNode): boolean {
  if (node.kind === 'conditional') return nodeIsPositioned(node.consequent)
  if (node.kind !== 'element' && node.kind !== 'componentRef') return false
  return node.className.split(/\s+/).includes('absolute')
}

function estimatedBottom(node: IRNode): number {
  if (node.kind === 'conditional') return estimatedBottom(node.consequent)
  if (node.kind !== 'element' && node.kind !== 'componentRef') return 1
  const top = measuredClass(node.className, 'top') ?? 0
  const height = measuredClass(node.className, 'h') ?? 1
  return Math.max(1, top + height)
}

function measuredClass(className: string, prefix: string): number | undefined {
  const token = className.split(/\s+/).find((item) => item.startsWith(`${prefix}-`))
  const raw = token?.slice(prefix.length + 1)
  const arbitrary = raw?.match(/^\[(-?\d+(?:\.\d+)?)(?:px)?\]$/)?.[1]
  if (arbitrary !== undefined) return Math.max(0, Number(arbitrary))
  const value = Number(raw)
  return Number.isFinite(value) ? Math.max(0, value * 4) : undefined
}

function warnPageFeatures(ir: IRTree, warn: FlutterWarningSink): void {
  if (ir.supabaseConfig || ir.listQueries?.length || ir.serverWorkflows?.length) {
    warn({
      code: 'flutter-remote-data-unsupported',
      message: 'Flutter static MVP omitted Supabase and server-workflow behavior',
      nodeId: ir.pageId
    })
  }
  if (ir.motion || ir.motionDrivers || ir.motionScene || ir.prototype) {
    warn({
      code: 'flutter-page-motion-unsupported',
      message: 'Flutter static MVP omitted page motion and prototype behavior',
      nodeId: ir.pageId
    })
  }
  for (const state of ir.docStates) {
    if (state.persist) {
      warn({
        code: 'flutter-document-state-persistence-unsupported',
        message: `Flutter keeps document state ${JSON.stringify(state.name)} in memory because persistence metadata is not implemented`,
        nodeId: state.id
      })
    }
    if (state.computed || state.computedInvalid) {
      warn({
        code: 'flutter-document-state-computed-unsupported',
        message: `Flutter emitted read-only default fallback for computed document state ${JSON.stringify(state.name)}`,
        nodeId: state.id
      })
    }
  }
}

function warnElementFeatures(node: IRElement, warn: FlutterWarningSink): void {
  const features = [
    node.module ? 'plugin module' : '',
    node.rawHtml ? 'raw HTML/vector markup' : '',
    node.upload ? 'upload' : '',
    node.overlay ? 'overlay' : '',
    node.validation ? 'advanced validation' : '',
    node.displayKind ? `display primitive ${node.displayKind}` : '',
    node.icon ? 'Lucide icon' : '',
    node.motion || node.motionDrivers || node.motionScene || node.generatedEffect
      ? 'motion/effect'
      : ''
  ].filter(Boolean)
  if (features.length) {
    warn({
      code: 'flutter-element-feature-unsupported',
      message: `Flutter static MVP emitted a static fallback and omitted: ${features.join(', ')}`,
      nodeId: node.sourceId
    })
  }
  if (node.link) {
    warn({
      code: 'flutter-external-link-unsupported',
      message:
        'Flutter source-only output does not add url_launcher; external links remain disabled',
      nodeId: node.sourceId
    })
  }
  for (const event of Object.keys(node.events ?? {})) {
    if (event !== 'onClick') {
      warn({
        code: 'flutter-event-unsupported',
        message: `Flutter static MVP dropped ${event} handler`,
        nodeId: node.sourceId
      })
    }
  }
  if (node.attrs.style && typeof node.attrs.style === 'object') {
    warn({
      code: 'flutter-inline-style-unsupported',
      message: 'Flutter static MVP dropped web inline style declarations',
      nodeId: node.sourceId
    })
  }
}

function unsupportedControl(node: IRElement): boolean {
  return (
    node.controlKind === 'select' ||
    node.controlKind === 'radio-group' ||
    node.controlKind === 'checkbox-group' ||
    node.tag === 'select' ||
    (node.tag === 'input' &&
      (node.attrs.type === 'radio' || node.attrs.type === 'file' || node.attrs.type === 'date'))
  )
}

function unsupportedControlLabel(node: IRElement): string {
  if (node.controlKind) return node.controlKind
  const type = staticAttr(node.attrs.type)
  return type ? `${node.tag}:${type}` : node.tag
}

function safeRemoteImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    )
  } catch {
    return false
  }
}

function intersperse(values: readonly string[], separator: string): string[] {
  return values.flatMap((value, index) => (index === 0 ? [value] : [separator, value]))
}

function indent(value: string, depth: number): string {
  const prefix = '  '.repeat(depth)
  return value
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : line))
    .join('\n')
}

function dartDouble(value: number): string {
  if (!Number.isFinite(value)) return '1.0'
  return Number.isInteger(value) ? `${value}.0` : String(value)
}
