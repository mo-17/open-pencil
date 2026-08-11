import type { IRElement, IREventHandler, IREventName } from '#compiler/ir/types'

import {
  inspectLowcodeRouteParameters,
  lowcodeNavigationPathname
} from '@open-pencil/core/lowcode-validation'

import { vueValidationErrorId, vueValidationKeyBinding } from './lowcode/validation'
import {
  docStateTypeScript,
  escapeAttr,
  safeScript,
  sanitizeVueRouteTarget,
  scriptExpression,
  scriptJson,
  withLocalAliases,
  type VueEmitContext,
  type VueLocalBinding
} from './shared'

const EVENT_DIRECTIVES: Record<IREventName, string> = {
  onClick: 'click',
  onChange: 'change',
  onSubmit: 'submit',
  onFocus: 'focus',
  onBlur: 'blur'
}

const SUPPORTED_EVENT_KINDS = new Set<IREventHandler['kind']>([
  'setState',
  'setVariable',
  'navigate',
  'apiCall',
  'condition',
  'delay',
  'stop',
  'toast',
  'confirm',
  'clipboard'
])

export function emitControlledAttribute(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): { attrs: string[]; skip: IREventName } | null {
  const controlled = node.controlled
  if (!controlled) return null
  const read = context.identAliases.get(controlled.read) ?? controlled.read
  const scriptRead = context.refNames.has(read) ? `${read}.value` : read
  const option = controlledOptionValue(node, context, locals)
  const radio = node.attrs.type === 'radio'
  const checkboxGroup = node.attrs.type === 'checkbox' && controlled.write.targetType === 'array'
  const booleanLike = controlled.write.targetType === 'boolean'
  let binding = `:value="${escapeAttr(read)}"`
  if (booleanLike) binding = `:checked="${escapeAttr(read)}"`
  if (checkboxGroup) {
    binding = `:checked="${escapeAttr(`${read}.includes(${option.template})`)}"`
  }
  if (radio) binding = `:checked="${escapeAttr(`${read} === ${option.template}`)}"`
  const directive =
    radio || checkboxGroup || booleanLike || node.tag === 'select' ? 'change' : 'input'
  const functionName = eventFunctionName(context, node.sourceId, directive)
  let raw = controlledEventValue(controlled.write.targetType)
  if (checkboxGroup) {
    raw = `(__opEvent.target as HTMLInputElement).checked ? [...${scriptRead}, ${option.script}] : ${scriptRead}.filter((__opValue) => __opValue !== ${option.script})`
  }
  if (radio) raw = option.script
  const write = controlledWriteStatement(controlled, context, raw)
  const authored = node.events?.onChange ?? []
  const prelude = [write]
  if (node.validation) {
    const key = vueValidationKeyBinding(context, node.validation.key)
    prelude.push(`__validateFieldValue(${key}, ${raw})`)
  }
  registerEventFunction(context, functionName, authored, locals, prelude)
  const args = ['$event', ...locals.map((local) => local.alias)].join(', ')
  return {
    attrs: [binding, `@${directive}="${functionName}(${escapeAttr(args)})"`],
    skip: 'onChange'
  }
}

function controlledWriteStatement(
  controlled: NonNullable<IRElement['controlled']>,
  context: VueEmitContext,
  raw: string
): string {
  if (controlled.write.kind === 'docState') {
    return `__setDocState(${scriptJson(controlled.write.name)}, ${raw})`
  }
  if (!context.writableStateNames.has(controlled.write.name)) {
    context.warnings.push({
      code: 'vue-state-write-unavailable',
      message: `Vue output omitted a write to unavailable page state '${controlled.write.name}'.`
    })
    return 'void 0'
  }
  return `${context.writableStateNames.get(controlled.write.name)}.value = ${raw}`
}

function controlledEventValue(
  type: NonNullable<IRElement['controlled']>['write']['targetType']
): string {
  if (type === 'boolean') return '(__opEvent.target as HTMLInputElement).checked'
  if (type === 'number') return 'Number((__opEvent.target as HTMLInputElement).value)'
  return '(__opEvent.target as HTMLInputElement).value'
}

function controlledOptionValue(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): { template: string; script: string } {
  const value = node.attrs.value
  context.expressionIndex += 1
  const name = `__opOption_${context.expressionIndex}`
  if (typeof value === 'object' && value.kind === 'exprAttr') {
    const aliases = withLocalAliases(context.identAliases, locals)
    const script = scriptExpression(value.ast, context.refNames, aliases)
    if (locals.length === 0) {
      context.templateBindings.push(`const ${name} = __vueComputed(() => ${script})`)
      return { template: name, script }
    }
    const params = locals.map((local) => `${local.alias}: any`).join(', ')
    const args = locals.map((local) => local.alias).join(', ')
    context.templateBindings.push(`const ${name} = (${params}) => ${script}`)
    return {
      template: `${name}(${args})`,
      script
    }
  }
  let literal: string | number | boolean = ''
  if (typeof value === 'object' && value.kind === 'intlMessage') literal = value.defaultMessage
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    literal = value
  }
  const source = scriptJson(literal)
  context.templateBindings.push(`const ${name} = ${source}`)
  return { template: name, script: source }
}

export function emitEventAttributes(
  events: IRElement['events'],
  context: VueEmitContext,
  sourceId: string,
  locals: readonly VueLocalBinding[],
  skip?: string | ReadonlySet<string>
): string[] {
  const attrs: string[] = []
  for (const [eventName, rawHandlers] of Object.entries(events ?? {}) as [
    IREventName,
    IREventHandler[] | undefined
  ][]) {
    if (eventSkipped(eventName, skip) || !rawHandlers) continue
    const handlers = supportedHandlers(rawHandlers, context.routerAvailable)
    const directive = EVENT_DIRECTIVES[eventName]
    if (handlers.length === 0) {
      if (eventName === 'onSubmit') attrs.push('@submit.prevent')
      continue
    }
    const functionName = eventFunctionName(context, sourceId, directive)
    registerEventFunction(context, functionName, handlers, locals)
    const args = ['$event', ...locals.map((local) => local.alias)].join(', ')
    const modifier = eventName === 'onSubmit' ? '.prevent' : ''
    attrs.push(`@${directive}${modifier}="${functionName}(${escapeAttr(args)})"`)
  }
  return attrs
}

function eventSkipped(eventName: string, skip: string | ReadonlySet<string> | undefined): boolean {
  if (typeof skip === 'string') return eventName === skip
  return skip?.has(eventName) ?? false
}

export function emitValidationEventAttributes(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string[] {
  const validation = node.validation
  if (!validation) return []
  const key = vueValidationKeyBinding(context, validation.key)
  const errorId = vueValidationErrorId(validation.key)
  let validationCall = `__validateField(${key})`
  if (node.controlled?.write.targetType === 'boolean') {
    validationCall = `__validateFieldValue(${key}, (__opEvent.target as HTMLInputElement).checked)`
  } else if (node.controlled) {
    validationCall = `__validateFieldValue(${key}, (__opEvent.target as HTMLInputElement).value)`
  }
  const functionName = eventFunctionName(context, node.sourceId, 'blur')
  registerEventFunction(context, functionName, node.events?.onBlur ?? [], locals, [validationCall])
  const args = ['$event', ...locals.map((local) => local.alias)].join(', ')
  return [
    `:aria-invalid="__fieldErrors[${key}] != null"`,
    `:aria-describedby="__fieldErrors[${key}] ? '${errorId}' : undefined"`,
    'data-openpencil-validation-field',
    `:data-openpencil-validation-invalid="__fieldErrors[${key}] ? 'true' : undefined"`,
    `@blur="${functionName}(${escapeAttr(args)})"`
  ]
}

export function emitValidatedSubmitAttribute(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string {
  const keys = node.formValidationKeys ?? []
  const handlers = supportedHandlers(node.events?.onSubmit ?? [], context.routerAvailable)
  const functionName = eventFunctionName(context, node.sourceId, 'submit')
  const keySource = keys.map((key) => scriptJson(key)).join(', ')
  registerEventFunction(context, functionName, handlers, locals, [
    `if (!__validateFields([${keySource}])) return`
  ])
  const args = ['$event', ...locals.map((local) => local.alias)].join(', ')
  return `@submit.prevent="${functionName}(${escapeAttr(args)})"`
}

function registerEventFunction(
  context: VueEmitContext,
  name: string,
  handlers: readonly IREventHandler[],
  locals: readonly VueLocalBinding[],
  prelude: readonly string[] = []
): void {
  const handlerAliases = new Map(context.identAliases)
  const localParams = locals.map((local) => {
    handlerAliases.set(local.name, local.alias)
    return `${local.alias}: any`
  })
  const params = ['__opEvent: Event', ...localParams].join(', ')
  const statements = emitHandlerList(handlers, context, handlerAliases)
  const body = [
    `const $event = __opEvent`,
    `const $value = (__opEvent.target as HTMLInputElement | null)?.value ?? ''`,
    ...prelude,
    ...statements
  ]
    .filter(Boolean)
    .map((line) => `  ${line}`)
    .join('\n')
  context.eventFunctions.push(`async function ${name}(${params}): Promise<void> {\n${body}\n}`)
}

function emitHandlerList(
  handlers: readonly IREventHandler[],
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string[] {
  const lines: string[] = []
  for (const handler of handlers) lines.push(...emitHandler(handler, context, aliases))
  return lines
}

// oxlint-disable-next-line complexity -- The switch is deliberately exhaustive over the Vue v1 event contract.
function emitHandler(
  handler: IREventHandler,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string[] {
  switch (handler.kind) {
    case 'setState': {
      if (!context.writableStateNames.has(handler.stateName)) return []
      const stateName = context.writableStateNames.get(handler.stateName) as string
      const expressionAliases = new Map(aliases)
      if (handler.mode === 'functional') {
        expressionAliases.set('prev', '__opPrevious')
        const expression = scriptExpression(handler.ast, context.refNames, expressionAliases)
        return [`{ const __opPrevious = ${stateName}.value; ${stateName}.value = ${expression} }`]
      }
      const expression = scriptExpression(handler.ast, context.refNames, expressionAliases)
      return [`${stateName}.value = ${expression}`]
    }
    case 'setVariable': {
      const expressionAliases = new Map(aliases)
      if (handler.mode === 'functional') {
        expressionAliases.set('prev', '__opPrevious')
        const expression = scriptExpression(handler.ast, context.refNames, expressionAliases)
        return [
          `{ const __opPrevious = __getDocState<${docStateTypeScript(context.docStateTypes.get(handler.docStateName))}>(${scriptJson(handler.docStateName)}); __setDocState(${scriptJson(handler.docStateName)}, ${expression}) }`
        ]
      }
      const expression = scriptExpression(handler.ast, context.refNames, expressionAliases)
      return [`__setDocState(${scriptJson(handler.docStateName)}, ${expression})`]
    }
    case 'navigate':
      return emitNavigate(handler, context, aliases)
    case 'apiCall': {
      const url = scriptExpression(handler.url, context.refNames, aliases)
      const init =
        handler.method === 'POST'
          ? `, { method: 'POST', headers: { 'Content-Type': 'application/json' }${
              handler.body === undefined
                ? ''
                : `, body: JSON.stringify(${safeScript(handler.body)})`
            } }`
          : ''
      const successAliases = new Map(aliases)
      successAliases.set('data', '__opData')
      const failureAliases = new Map(aliases)
      failureAliases.set('error', '__opError')
      failureAliases.set('err', '__opError')
      const success = emitHandlerList(handler.onSuccess ?? [], context, successAliases).join('; ')
      const failure = emitHandlerList(handler.onError ?? [], context, failureAliases).join('; ')
      const errorWrite = handler.errorTarget
        ? `__setDocState(${scriptJson(handler.errorTarget)}, __opError); `
        : ''
      return [
        `try { const __opResponse = await fetch(${url}${init}); const __opData = await __opResponse.json(); if (!__opResponse.ok) throw __opData; __setDocState(${scriptJson(handler.docStateName)}, __opData); ${success} } catch (__opError) { ${errorWrite}${failure || 'console.error(__opError)'} }`
      ]
    }
    case 'condition': {
      const consequent = emitHandlerList(handler.consequent, context, aliases).join('; ')
      const alternate = emitHandlerList(handler.alternate ?? [], context, aliases).join('; ')
      const suffix = alternate ? ` else { ${alternate} }` : ''
      return [
        `if (${scriptExpression(handler.condAst, context.refNames, aliases)}) { ${consequent} }${suffix}`
      ]
    }
    case 'toast':
      return [emitToast(handler, context, aliases)]
    case 'confirm':
      return [emitConfirm(handler, context, aliases)]
    case 'delay':
      return [`await new Promise<void>((resolve) => setTimeout(resolve, ${handler.ms}))`]
    case 'stop':
      return ['return']
    case 'clipboard':
      return [
        `await navigator.clipboard.writeText(String(${scriptExpression(handler.ast, context.refNames, aliases)}))`
      ]
    default:
      return []
  }
}

function emitToast(
  handler: Extract<IREventHandler, { kind: 'toast' }>,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string {
  const message = scriptExpression(handler.ast, context.refNames, aliases)
  const options = objectLiteral([
    ['position', handler.position === undefined ? undefined : scriptJson(handler.position)],
    ['durationMs', handler.durationMs === undefined ? undefined : String(handler.durationMs)]
  ])
  if (!options) {
    return handler.variant === 'info'
      ? `__opToast(${message})`
      : `__opToast(${message}, ${scriptJson(handler.variant)})`
  }
  return `__opToast(${message}, ${scriptJson(handler.variant)}, ${options})`
}

function emitConfirm(
  handler: Extract<IREventHandler, { kind: 'confirm' }>,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string {
  const message = scriptExpression(handler.ast, context.refNames, aliases)
  const options = objectLiteral([
    [
      'confirmLabel',
      handler.confirmLabel === undefined ? undefined : scriptJson(handler.confirmLabel)
    ],
    ['cancelLabel', handler.cancelLabel === undefined ? undefined : scriptJson(handler.cancelLabel)]
  ])
  const call = options ? `__opConfirm(${message}, ${options})` : `__opConfirm(${message})`
  const consequent = emitHandlerList(handler.consequent, context, aliases).join('; ')
  const alternate = emitHandlerList(handler.alternate ?? [], context, aliases).join('; ')
  return `if (await ${call}) { ${consequent} }${alternate ? ` else { ${alternate} }` : ''}`
}

function objectLiteral(entries: readonly [string, string | undefined][]): string {
  const present = entries.filter((entry): entry is [string, string] => entry[1] !== undefined)
  if (present.length === 0) return ''
  return `{ ${present.map(([key, value]) => `${key}: ${value}`).join(', ')} }`
}

function emitNavigate(
  handler: Extract<IREventHandler, { kind: 'navigate' }>,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string[] {
  if (!context.routerAvailable) return []
  const route = sanitizeVueRouteTarget(handler.to)
  if (!route) {
    context.warnings.push({
      code: 'vue-navigate-target-unsafe',
      message: `Vue v1 omitted an unsafe navigation target '${handler.to}'.`
    })
    return []
  }
  const pathname = lowcodeNavigationPathname(route)
  const suffix = route.slice(pathname.length)
  const inspected = inspectLowcodeRouteParameters(pathname)
  const malformed = inspected.issues.filter(
    (issue) => !issue.startsWith('duplicate route parameter ')
  )
  if (malformed.length > 0) {
    context.warnings.push({
      code: 'vue-navigate-route-invalid',
      message: `Vue v1 omitted navigation to '${handler.to}' because its route pattern is invalid: ${malformed.join('; ')}.`
    })
    return []
  }
  const params = new Map((handler.params ?? []).map((param) => [param.name, param]))
  const missing = [
    ...new Set(
      inspected.parameters.filter((parameter) => !parameter.optional).map(({ name }) => name)
    )
  ].filter((name) => !params.has(name))
  if (missing.length > 0) {
    context.warnings.push({
      code: 'vue-navigate-param-missing',
      message: `Vue v1 omitted navigation to '${handler.to}' because route parameter(s) ${missing.join(', ')} have no value.`
    })
    return []
  }
  if (inspected.parameters.length === 0) return [`await __opRouter.push(${scriptJson(route)})`]
  const values = [...new Set(inspected.parameters.map(({ name }) => name))]
    .filter((name) => params.has(name))
    .map((name) => {
      const param = params.get(name) as NonNullable<typeof handler.params>[number]
      const value = scriptExpression(param.ast, context.refNames, aliases)
      return `${scriptJson(name)}: encodeURIComponent(String(${value}))`
    })
    .join(', ')
  return [
    `{ const __opRouteValues: Record<string, string> = { ${values} }; const __opPath = ${scriptJson(pathname)}.split('/').flatMap((__opSegment) => { const __opMatch = /^:([A-Za-z_][A-Za-z0-9_]*)(\\?)?$/.exec(__opSegment); if (!__opMatch) return [__opSegment]; if (Object.prototype.hasOwnProperty.call(__opRouteValues, __opMatch[1])) return [__opRouteValues[__opMatch[1]]]; return __opMatch[2] ? [] : [__opSegment] }).join('/'); await __opRouter.push(__opPath + ${scriptJson(suffix)}) }`
  ]
}

function supportedHandlers(
  handlers: readonly IREventHandler[],
  routerAvailable: boolean
): IREventHandler[] {
  return handlers.filter((handler) => {
    if (!SUPPORTED_EVENT_KINDS.has(handler.kind)) return false
    return handler.kind !== 'navigate' || routerAvailable
  })
}

function eventFunctionName(context: VueEmitContext, sourceId: string, event: string): string {
  context.eventIndex += 1
  const stem = `${sourceId}_${event}`.replace(/[^A-Za-z0-9_$]/g, '_').slice(0, 48)
  return `__op_${stem || 'event'}_${context.eventIndex}`
}
