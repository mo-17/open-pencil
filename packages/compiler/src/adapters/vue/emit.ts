import type { ComponentDef, IRElement, IRNode, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions } from '#compiler/types'

import {
  emitVueElementAttributes,
  emitVueStyleExpression,
  vueStyleAssetImportLines
} from './element-attributes'
import { emitEventAttributes } from './events'
import { safeVueTag, VUE_VOID_TAGS } from './html'
import { collectVueComponentLowcodeUsage, collectVueTreeLowcodeUsage } from './lowcode/usage'
import {
  buildVueValidationGlue,
  vueValidationErrorId,
  vueValidationKeyBinding
} from './lowcode/validation'
import { emitVueModuleElement } from './modules/emit'
import { buildVueModuleImports, findVueModuleAdapter } from './modules/registry'
import {
  componentPropAlias,
  componentRuntimeAlias,
  createContext,
  createLocalBinding,
  CURRENT_USER_FALLBACK,
  currentUserBindingWarning,
  docStateTypeScript,
  escapeAttr,
  escapeStaticText,
  generatedAlias,
  identifierShadowWarning,
  SAFE_HREF_RUNTIME,
  scopedIdentifier,
  scriptExpression,
  scriptJSON,
  templateExpression,
  withLocalAliases,
  type VueEmitContext,
  type VueLocalBinding
} from './shared'

export { sanitizeVueHrefLiteral } from './shared'

const ROUTE_PARAMS_IDENT = '$params'
const QUERY_PARAMS_IDENT = '$query'

export interface VueSourceEmission {
  source: string
  warnings: CompileWarning[]
}

function appendVueContextRuntime(
  scriptLines: string[],
  validatedFields: Parameters<typeof buildVueValidationGlue>[0],
  context: VueEmitContext
): void {
  scriptLines.push(...buildVueValidationGlue(validatedFields, context))
  scriptLines.push(...context.templateBindings)
  if (context.safeHrefRequired) scriptLines.push(SAFE_HREF_RUNTIME)
  scriptLines.push(...context.eventFunctions)
}

// oxlint-disable-next-line complexity -- Page emission assembles independent router, state, asset, and event capabilities.
export function buildVuePageModule(
  ir: IRTree,
  options: CompilerOptions,
  routerAvailable: boolean
): VueSourceEmission {
  const lowcode = collectVueTreeLowcodeUsage(ir)
  const validatedFields = ir.validatedFields ?? []
  const identAliases = new Map<string, string>()
  const listAliases = new Map<string, string>()
  for (const state of ir.states) identAliases.set(state.name, generatedAlias('State', state.name))
  const pageStateNames = new Set(ir.states.map((state) => state.name))
  const docStateTypes = new Map(ir.docStates.map((state) => [state.name, state.type]))
  const componentNames = referencedComponents(ir.children)
  const componentAliases = new Map(
    componentNames.map((name) => [name, componentRuntimeAlias(name)])
  )
  const docStateReads = ir.docStateReads.filter(
    (name) => name !== '$currentUser' || !ir.supabaseConfig
  )
  for (const name of docStateReads) {
    if (!identAliases.has(name)) identAliases.set(name, generatedAlias('Doc', name))
  }
  for (const query of ir.listQueries ?? []) {
    const alias = generatedAlias('Rows', query.rowsName)
    listAliases.set(query.rowsName, alias)
    if (!identAliases.has(query.rowsName)) identAliases.set(query.rowsName, alias)
  }
  const refNames = new Set([...identAliases.values(), ...listAliases.values()])
  const context = createContext(
    options.devMode,
    routerAvailable,
    refNames,
    ir.states,
    identAliases,
    listAliases,
    docStateTypes,
    componentAliases
  )
  for (const name of docStateReads) {
    if (pageStateNames.has(name)) {
      context.warnings.push(identifierShadowWarning(name, 'document state', 'page state'))
    }
  }
  for (const query of ir.listQueries ?? []) {
    if (identAliases.get(query.rowsName) !== listAliases.get(query.rowsName)) {
      context.warnings.push(identifierShadowWarning(query.rowsName, 'list rows', 'page state'))
    }
  }
  if (ir.supabaseConfig && ir.docStateReads.includes('$currentUser')) {
    context.warnings.push(currentUserBindingWarning())
  }
  const template = ir.requiresAuth
    ? '    <section data-openpencil-unsupported="auth-guard">Authentication required.</section>\n'
    : emitNodes(ir.children, context, 1, [])
  const vueImports = `import { computed as __vueComputed, ref as __vueRef } from 'vue'`
  const routerImports = routerAvailable
    ? `\nimport { useRoute as __useRoute, useRouter as __useRouter } from 'vue-router'`
    : ''
  const componentImports = componentNames
    .map((name) => `import ${componentAliases.get(name)} from '../components/${name}.vue'`)
    .join('\n')
  const moduleImports = buildVueModuleImports(ir.children)
  const docStateActive =
    ir.docStates.length > 0 || ir.docStateReads.length > 0 || ir.docStateWrites.length > 0
  const docImport = docStateActive
    ? `import { getDocState as __getDocState, setDocState as __setDocState, useDocState as __useDocState } from '../lowcode-state'`
    : ''
  const scriptLines: string[] = [vueImports + routerImports]
  if (componentImports) scriptLines.push(componentImports)
  if (moduleImports) scriptLines.push(moduleImports)
  if (lowcode.toast) scriptLines.push(`import { __opToast } from '../lowcode-toast'`)
  if (lowcode.confirm) scriptLines.push(`import { __opConfirm } from '../lowcode-confirm'`)
  if (lowcode.validation) {
    scriptLines.push(`import { __opValidateValue } from '../lowcode-validation'`)
  }
  scriptLines.push(...vueStyleAssetImportLines(context))
  if (docImport) scriptLines.push(docImport)
  if (routerAvailable) {
    scriptLines.push('const __opRouter = __useRouter()', 'const __opRoute = __useRoute()')
    scriptLines.push('const $params = __opRoute.params', 'const $query = __opRoute.query')
  } else if (ir.usesRouteParams || ir.usesQueryParams) {
    scriptLines.push('const $params: Record<string, string> = {}')
    scriptLines.push('const $query: Record<string, string> = {}')
  }
  if (ir.supabaseConfig) scriptLines.push(CURRENT_USER_FALLBACK)
  for (const query of ir.listQueries ?? []) {
    scriptLines.push(`const ${listAliases.get(query.rowsName)} = __vueRef<unknown[]>([])`)
  }
  for (const state of ir.states) scriptLines.push(emitState(state, context))
  for (const name of docStateReads) {
    if (pageStateNames.has(name)) continue
    scriptLines.push(
      `const ${identAliases.get(name)} = __useDocState<${docStateTypeScript(docStateTypes.get(name))}>(${scriptJSON(name)})`
    )
  }
  appendVueContextRuntime(scriptLines, validatedFields, context)
  return {
    source: `<script setup lang="ts">
${scriptLines.filter(Boolean).join('\n')}
</script>

<template>
  <main${pageRootAttrs(ir, options.devMode)}>
${template}  </main>
</template>
`,
    warnings: context.warnings
  }
}

// oxlint-disable-next-line complexity -- Component emission handles props, variants, state, and fallback rendering in one SFC.
export function buildVueComponentModule(
  definition: ComponentDef,
  options: CompilerOptions,
  routerAvailable: boolean,
  docStateTypes: ReadonlyMap<string, IRTree['docStates'][number]['type']> = new Map()
): VueSourceEmission {
  const lowcode = collectVueComponentLowcodeUsage(definition)
  const validatedFields = definition.validatedFields ?? []
  const rawDocStateReads = definition.docStateReads ?? []
  const currentUserUnsupported = rawDocStateReads.includes('$currentUser')
  const usesRouteParams = rawDocStateReads.includes(ROUTE_PARAMS_IDENT)
  const usesQueryParams = rawDocStateReads.includes(QUERY_PARAMS_IDENT)
  const docStateReads = rawDocStateReads.filter(
    (name) => name !== '$currentUser' && name !== ROUTE_PARAMS_IDENT && name !== QUERY_PARAMS_IDENT
  )
  const propDefs = [
    ...definition.props,
    ...(definition.variantAxes ?? []).map((axis) => ({
      name: axis.name,
      kind: 'variant' as const,
      defaultValue: axis.defaultValue
    }))
  ]
  const propNames = new Set(propDefs.map((prop) => prop.name))
  const identAliases = new Map(propDefs.map((prop) => [prop.name, componentPropAlias(prop.name)]))
  const bodyNodes = definition.variants
    ? definition.variants.flatMap((variant) => variant.children)
    : definition.children
  const componentNames = referencedComponents(bodyNodes).filter((name) => name !== definition.name)
  const componentAliases = new Map(
    componentNames.map((name) => [name, componentRuntimeAlias(name)])
  )
  const moduleImports = buildVueModuleImports(bodyNodes)
  for (const name of docStateReads) {
    if (!identAliases.has(name)) identAliases.set(name, generatedAlias('Doc', name))
  }
  const refNames = new Set(identAliases.values())
  const context = createContext(
    options.devMode,
    routerAvailable,
    refNames,
    [],
    identAliases,
    new Map(),
    docStateTypes,
    componentAliases
  )
  if (currentUserUnsupported) context.warnings.push(currentUserBindingWarning())
  for (const name of docStateReads) {
    if (propNames.has(name)) {
      context.warnings.push(identifierShadowWarning(name, 'document state', 'component prop'))
    }
  }
  const vueImports = lowcode.validation
    ? `import { computed as __vueComputed, ref as __vueRef } from 'vue'`
    : `import { computed as __vueComputed } from 'vue'`
  const scriptLines = [vueImports]
  if (routerAvailable) {
    const imports = [
      ...(usesRouteParams || usesQueryParams ? ['useRoute as __useRoute'] : []),
      'useRouter as __useRouter'
    ]
    scriptLines.push(
      `import { ${imports.join(', ')} } from 'vue-router'`,
      'const __opRouter = __useRouter()'
    )
    if (usesRouteParams || usesQueryParams) {
      scriptLines.push('const __opRoute = __useRoute()')
      if (usesRouteParams) scriptLines.push('const $params = __opRoute.params')
      if (usesQueryParams) scriptLines.push('const $query = __opRoute.query')
    }
  } else {
    if (usesRouteParams) scriptLines.push('const $params: Record<string, string> = {}')
    if (usesQueryParams) scriptLines.push('const $query: Record<string, string> = {}')
  }
  for (const name of componentNames) {
    scriptLines.push(`import ${componentAliases.get(name)} from './${name}.vue'`)
  }
  if (moduleImports) scriptLines.push(moduleImports)
  if (lowcode.toast) scriptLines.push(`import { __opToast } from '../lowcode-toast'`)
  if (lowcode.confirm) scriptLines.push(`import { __opConfirm } from '../lowcode-confirm'`)
  if (lowcode.validation) {
    scriptLines.push(`import { __opValidateValue } from '../lowcode-validation'`)
  }
  if (docStateReads.length > 0 || (definition.docStateWrites?.length ?? 0) > 0) {
    scriptLines.push(
      `import { getDocState as __getDocState, setDocState as __setDocState, useDocState as __useDocState } from '../lowcode-state'`
    )
  }
  if (currentUserUnsupported) scriptLines.push(CURRENT_USER_FALLBACK)
  if (propDefs.length > 0) {
    const fields = propDefs
      .map((prop) => {
        const type = prop.kind === 'style' ? 'Record<string, string>' : 'string'
        return `  ${identAliases.get(prop.name)}?: ${type}`
      })
      .join('\n')
    scriptLines.push(`const __opProps = defineProps<{\n${fields}\n}>()`)
    for (const prop of propDefs) {
      const alias = identAliases.get(prop.name) as string
      if (prop.kind === 'style') {
        scriptLines.push(`const ${alias} = __vueComputed(() => __opProps.${alias})`)
      } else {
        scriptLines.push(
          `const ${alias} = __vueComputed(() => __opProps.${alias} ?? ${scriptJSON(prop.defaultValue)})`
        )
      }
    }
  }
  for (const name of docStateReads) {
    if (propNames.has(name)) continue
    scriptLines.push(
      `const ${identAliases.get(name)} = __useDocState<${docStateTypeScript(docStateTypes.get(name))}>(${scriptJSON(name)})`
    )
  }

  let template: string
  if (definition.variants && definition.variantAxes) {
    const key = definition.variantAxes
      .map((axis) => `${identAliases.get(axis.name)}.value`)
      .join(', ')
    scriptLines.push(`const __variantKey = __vueComputed(() => [${key}].join('|'))`)
    const defaultKey = definition.variantAxes.map((axis) => axis.defaultValue).join('|')
    const fallback =
      definition.variants.find((variant) => variant.key === defaultKey) ?? definition.variants[0]
    const guarded = definition.variants.filter((variant) => variant !== fallback)
    if (guarded.length === 0) {
      template = emitNodes(fallback.children, context, 2, [])
    } else {
      template = [
        ...guarded.map((variant, index) => {
          const directive = index === 0 ? 'v-if' : 'v-else-if'
          const nodes = emitNodes(variant.children, context, 2, [])
          return `    <template ${directive}="__variantKey === ${escapeAttr(scriptJSON(variant.key))}">\n${nodes}    </template>\n`
        }),
        `    <template v-else>\n${emitNodes(fallback.children, context, 2, [])}    </template>\n`
      ].join('')
    }
  } else {
    template = emitNodes(definition.children, context, 2, [])
  }
  scriptLines.splice(1, 0, ...vueStyleAssetImportLines(context))
  appendVueContextRuntime(scriptLines, validatedFields, context)
  return {
    source: `<script setup lang="ts">
${scriptLines.join('\n')}
</script>

<template>
  <div${options.devMode ? ` data-node-id="${escapeAttr(definition.componentId)}"` : ''}>
${template}  </div>
</template>
`,
    warnings: context.warnings
  }
}

function emitState(state: IRTree['states'][number], context: VueEmitContext): string {
  const name = context.identAliases.get(state.name) ?? state.name
  const value = serializeDefault(state.defaultValue, state.type)
  const type = docStateTypeScript(state.type)
  if (state.computed) {
    return `const ${name} = __vueComputed<${type}>(() => ${scriptExpression(state.computed.ast, context.refNames, context.identAliases)})`
  }
  if (state.computedInvalid) return `const ${name} = __vueComputed<${type}>(() => ${value})`
  return `const ${name} = __vueRef<${type}>(${value})`
}

function emitNodes(
  nodes: readonly IRNode[],
  context: VueEmitContext,
  indent: number,
  locals: readonly VueLocalBinding[]
): string {
  return nodes.map((node) => emitNode(node, context, indent, locals)).join('')
}

function emitNode(
  node: IRNode,
  context: VueEmitContext,
  indent: number,
  locals: readonly VueLocalBinding[]
): string {
  const pad = '  '.repeat(indent)
  switch (node.kind) {
    case 'text':
      return `${pad}${escapeStaticText(node.value)}\n`
    case 'expression': {
      context.expressionIndex += 1
      const name = `__opTextExpr_${context.expressionIndex}`
      const fallback = node.fallback === undefined ? '' : ` ?? ${scriptJSON(node.fallback)}`
      const aliases = withLocalAliases(context.identAliases, locals)
      const expression = scriptExpression(node.ast, context.refNames, aliases)
      if (locals.length === 0) {
        context.templateBindings.push(
          `const ${name} = __vueComputed(() => ${expression}${fallback})`
        )
        return `${pad}{{ ${name} }}\n`
      }
      const params = locals.map((local) => `${local.alias}: any`).join(', ')
      const args = locals.map((local) => local.alias).join(', ')
      context.templateBindings.push(`const ${name} = (${params}) => ${expression}${fallback}`)
      return `${pad}{{ ${name}(${args}) }}\n`
    }
    case 'conditional':
      return `${pad}<template v-if="${escapeAttr(templateExpression(node.ast, context.identAliases, locals))}">\n${emitNode(
        node.consequent,
        context,
        indent + 1,
        locals
      )}${pad}</template>\n`
    case 'list': {
      const item = createLocalBinding(node.itemName, locals.length)
      const index = createLocalBinding(node.indexName, locals.length + 1)
      const nextLocals = [...locals, item, index]
      const arrayName =
        context.listAliases.get(node.arrayName) ??
        scopedIdentifier(node.arrayName, context.identAliases, locals)
      const expression = `(${arrayName} ?? [])`
      return `${pad}<template v-for="(${item.alias}, ${index.alias}) in ${escapeAttr(expression)}" :key="${escapeAttr(index.alias)}">\n${emitNode(
        node.template,
        context,
        indent + 1,
        nextLocals
      )}${pad}</template>\n`
    }
    case 'componentRef': {
      const attrs: string[] = []
      if (node.className) attrs.push(`class="${escapeAttr(node.className)}"`)
      if (node.styleAttr)
        attrs.push(`:style="${escapeAttr(emitVueStyleExpression(node.styleAttr, context))}"`)
      if (context.devMode) attrs.push(`data-node-id="${escapeAttr(node.sourceId)}"`)
      for (const prop of node.props) {
        const propName = componentPropAlias(prop.name)
        if (typeof prop.value === 'string') {
          attrs.push(`${propName}="${escapeAttr(prop.value)}"`)
        } else if (prop.kind === 'style') {
          attrs.push(
            `:${propName}="${escapeAttr(
              emitVueStyleExpression({ kind: 'styleAttr', declarations: prop.value }, context)
            )}"`
          )
        } else {
          attrs.push(`:${propName}="${escapeAttr(scriptJSON(prop.value))}"`)
        }
      }
      attrs.push(...emitEventAttributes(node.events, context, node.sourceId, locals))
      const component = context.componentAliases.get(node.name) ?? node.name
      return `${pad}<${component}${attrs.length ? ` ${attrs.join(' ')}` : ''} />\n`
    }
    case 'element':
      return emitElement(node, context, indent, locals)
  }
  throw new Error('Unsupported Vue IR node')
}

function emitElement(
  node: IRElement,
  context: VueEmitContext,
  indent: number,
  locals: readonly VueLocalBinding[]
): string {
  const element = emitElementCore(node, context, indent, locals)
  if (!node.validation) return element
  return `${element}${emitValidationError(node.validation.key, context, indent)}`
}

function emitElementCore(
  node: IRElement,
  context: VueEmitContext,
  indent: number,
  locals: readonly VueLocalBinding[]
): string {
  const moduleAdapter = node.module ? findVueModuleAdapter(node.module) : null
  if (moduleAdapter) {
    return emitVueModuleElement(node, moduleAdapter, context, indent, {
      attrs: emitVueElementAttributes(node, context, locals),
      children: emitNodes(node.children, context, indent + 1, locals)
    })
  }
  const pad = '  '.repeat(indent)
  let tagName = node.tag
  if (node.image) tagName = 'img'
  if (node.link) tagName = 'a'
  const tag = safeVueTag(tagName)
  const attrs = emitVueElementAttributes(node, context, locals)
  const open = `${pad}<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`
  if (VUE_VOID_TAGS.has(tag)) return `${open} />\n`
  if (node.rawHtml !== undefined) return `${open}></${tag}>\n`
  const children = emitNodes(node.children, context, indent + 1, locals)
  const summary =
    node.formValidationSummary && node.formValidationKeys
      ? emitValidationSummary(
          node.formValidationKeys,
          node.formValidationSummary.title,
          context,
          indent + 1
        )
      : ''
  return `${open}>\n${summary}${children}${pad}</${tag}>\n`
}

function emitValidationError(key: string, context: VueEmitContext, indent: number): string {
  const pad = '  '.repeat(indent)
  const binding = vueValidationKeyBinding(context, key)
  const id = vueValidationErrorId(key)
  return `${pad}<p v-if="${binding} in __fieldErrors && __fieldErrors[${binding}]" id="${id}" class="openpencil-validation-error" role="alert">{{ __fieldErrors[${binding}] }}</p>\n`
}

function emitValidationSummary(
  keys: readonly string[],
  title: string,
  context: VueEmitContext,
  indent: number
): string {
  const pad = '  '.repeat(indent)
  const innerPad = '  '.repeat(indent + 1)
  const itemPad = '  '.repeat(indent + 2)
  context.expressionIndex += 1
  const binding = `__opValidationSummaryKeys_${context.expressionIndex}`
  context.templateBindings.push(`const ${binding} = ${scriptJSON(keys)}`)
  return [
    `${pad}<div v-if="${binding}.some((id) => __fieldErrors[id])" class="openpencil-validation-error" role="alert">`,
    `${innerPad}<p>${escapeStaticText(title)}</p>`,
    `${innerPad}<ul>`,
    `${itemPad}<li v-for="id in ${binding}.filter((item) => __fieldErrors[item])" :key="id">{{ __fieldErrors[id] }}</li>`,
    `${innerPad}</ul>`,
    `${pad}</div>\n`
  ].join('\n')
}

function referencedComponents(nodes: readonly IRNode[]): string[] {
  const names = new Set<string>()
  const visit = (node: IRNode): void => {
    if (node.kind === 'componentRef') {
      names.add(node.name)
      return
    }
    if (node.kind === 'conditional') return visit(node.consequent)
    if (node.kind === 'list') return visit(node.template)
    if (node.kind === 'element') node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return [...names].sort((a, b) => a.localeCompare(b))
}

function pageRootAttrs(ir: IRTree, devMode: boolean): string {
  const attrs = [`class="min-h-screen"`]
  if (devMode) attrs.push(`data-node-id="${escapeAttr(ir.pageId)}"`)
  return ` ${attrs.join(' ')}`
}

function serializeDefault(value: unknown, type: IRTree['states'][number]['type']): string {
  if (type === 'string') return scriptJSON(typeof value === 'string' ? value : '')
  if (type === 'number')
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0'
  if (type === 'boolean') return value === true ? 'true' : 'false'
  if (type === 'array') return scriptJSON(Array.isArray(value) ? value : [])
  return scriptJSON(
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  )
}
