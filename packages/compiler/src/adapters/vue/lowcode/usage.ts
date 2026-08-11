import type { ComponentDef, IREventHandler, IRNode, IRTree } from '#compiler/ir/types'

export interface VueLowcodeUsage {
  toast: boolean
  confirm: boolean
  validation: boolean
}

const EMPTY_USAGE: VueLowcodeUsage = {
  toast: false,
  confirm: false,
  validation: false
}

export function collectVueTreeLowcodeUsage(ir: IRTree): VueLowcodeUsage {
  return mergeUsage(collectNodeUsage(ir.children), {
    ...EMPTY_USAGE,
    validation: (ir.validatedFields?.length ?? 0) > 0
  })
}

export function collectVueComponentLowcodeUsage(definition: ComponentDef): VueLowcodeUsage {
  const nodes = definition.variants
    ? definition.variants.flatMap((variant) => variant.children)
    : definition.children
  return mergeUsage(collectNodeUsage(nodes), {
    ...EMPTY_USAGE,
    validation: (definition.validatedFields?.length ?? 0) > 0
  })
}

export function collectVueProjectLowcodeUsage(
  irs: readonly IRTree[],
  components: readonly ComponentDef[]
): VueLowcodeUsage {
  let usage = { ...EMPTY_USAGE }
  for (const ir of irs) usage = mergeUsage(usage, collectVueTreeLowcodeUsage(ir))
  for (const definition of components) {
    usage = mergeUsage(usage, collectVueComponentLowcodeUsage(definition))
  }
  return usage
}

function collectNodeUsage(nodes: readonly IRNode[]): VueLowcodeUsage {
  let usage = { ...EMPTY_USAGE }
  const visit = (node: IRNode): void => {
    if (node.kind === 'text' || node.kind === 'expression') return
    if (node.kind === 'conditional') {
      visit(node.consequent)
      return
    }
    if (node.kind === 'list') {
      visit(node.template)
      return
    }
    usage = mergeUsage(usage, collectEventUsage(node.events))
    if (node.kind === 'element') node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return usage
}

function collectEventUsage(
  events: Partial<Record<string, IREventHandler[]>> | undefined
): VueLowcodeUsage {
  let usage = { ...EMPTY_USAGE }
  for (const handlers of Object.values(events ?? {})) {
    for (const handler of handlers ?? []) usage = mergeUsage(usage, collectHandlerUsage(handler))
  }
  return usage
}

function collectHandlerUsage(handler: IREventHandler): VueLowcodeUsage {
  let usage: VueLowcodeUsage = {
    ...EMPTY_USAGE,
    toast: handler.kind === 'toast',
    confirm: handler.kind === 'confirm'
  }
  if (handler.kind === 'condition' || handler.kind === 'confirm') {
    for (const item of handler.consequent) {
      usage = mergeUsage(usage, collectHandlerUsage(item))
    }
    for (const item of handler.alternate ?? []) {
      usage = mergeUsage(usage, collectHandlerUsage(item))
    }
  } else if (handler.kind === 'apiCall') {
    for (const item of handler.onSuccess ?? []) {
      usage = mergeUsage(usage, collectHandlerUsage(item))
    }
    for (const item of handler.onError ?? []) {
      usage = mergeUsage(usage, collectHandlerUsage(item))
    }
  }
  return usage
}

function mergeUsage(left: VueLowcodeUsage, right: VueLowcodeUsage): VueLowcodeUsage {
  return {
    toast: left.toast || right.toast,
    confirm: left.confirm || right.confirm,
    validation: left.validation || right.validation
  }
}
