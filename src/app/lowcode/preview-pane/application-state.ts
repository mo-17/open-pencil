import { resolveLowcodeApplicationPages, validateStateName } from '@open-pencil/lowcode'
import type { SceneGraph, StateValueType } from '@open-pencil/scene-graph'

import type { PreviewTarget } from './host/types'
import {
  createPreviewEditorMessage,
  PREVIEW_MESSAGE_LIMITS,
  type PreviewEditorPayload
} from './iframe/messages'

const VALIDATION_CHANNEL = 'application_state_cache_validation'
const MAX_ENTRIES = 64
const MAX_BYTES = 1024 * 1024
const encoder = new TextEncoder()

export type ApplicationPreviewStateEntry = Pick<
  Extract<PreviewEditorPayload, { type: 'docState' }>,
  'name' | 'value'
>

function stateType(value: unknown): value is StateValueType {
  return ['string', 'number', 'boolean', 'object', 'array'].includes(value as string)
}

export function applicationStateValueMatches(type: StateValueType, value: unknown): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  return typeof value === type
}

function declarationFor(definition: unknown, excludeComputed = false) {
  if (typeof definition !== 'object' || !definition || Array.isArray(definition)) return null
  if (![Object.prototype, null].includes(Object.getPrototypeOf(definition))) return null
  if (Object.getOwnPropertySymbols(definition).length) return null
  const fields: Record<string, unknown> = Object.create(null)
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(definition))) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null
    // Optional authored fields can be explicitly undefined after an editor update.
    if (descriptor.value !== undefined) fields[name] = descriptor.value
  }
  if (
    typeof fields.id !== 'string' ||
    !fields.id ||
    typeof fields.name !== 'string' ||
    !validateStateName(fields.name).ok ||
    !stateType(fields.type) ||
    (!excludeComputed && fields.computedExpr !== undefined)
  )
    return null
  return { fields, name: fields.name, type: fields.type }
}

/** Legacy callers reject or exclude computed values; policy signatures may include their definitions. */
export function applicationStateDeclarations(
  source: unknown,
  computedPolicy: boolean | 'include' = false
) {
  if (!Array.isArray(source) || source.length > PREVIEW_MESSAGE_LIMITS.stateValues) return null
  if (
    Object.getPrototypeOf(source) !== Array.prototype ||
    Object.getOwnPropertySymbols(source).length
  )
    return null
  const arrayDescriptors = Object.getOwnPropertyDescriptors(source)
  if (Object.keys(arrayDescriptors).length !== source.length + 1) return null
  const declarations: Record<string, unknown>[] = []
  const types = new Map<string, StateValueType>()
  for (let index = 0; index < source.length; index++) {
    const key = String(index)
    if (!Object.hasOwn(arrayDescriptors, key)) return null
    const entry = arrayDescriptors[key]
    if (!entry.enumerable || !Object.hasOwn(entry, 'value')) return null
    const declaration = declarationFor(entry.value, computedPolicy !== false)
    if (!declaration || types.has(declaration.name)) return null
    if (computedPolicy === true && declaration.fields.computedExpr !== undefined) continue
    types.set(declaration.name, declaration.type)
    declarations.push(declaration.fields)
  }
  // Reuse the existing data-only protocol boundary before serializing defaults.
  const checked = createPreviewEditorMessage(VALIDATION_CHANNEL, {
    type: 'docState',
    name: 'declarations',
    value: declarations
  })
  if (checked?.type !== 'docState') return null
  const signature = JSON.stringify(checked.value)
  if (encoder.encode(signature).byteLength > MAX_BYTES) return null
  return { types, signature }
}

/** Ephemeral document-state recovery for one application graph and web target. */
export function createApplicationPreviewStateCache() {
  let ownerGraph: SceneGraph | null = null
  let ownerTarget: PreviewTarget | null = null
  let declarationSignature: string | null = null
  let declarationTypes = new Map<string, StateValueType>()
  const values = new Map<string, { value: unknown; bytes: number }>()
  let totalBytes = 2

  function clear(): void {
    ownerGraph = null
    ownerTarget = null
    declarationSignature = null
    declarationTypes.clear()
    values.clear()
    totalBytes = 2
  }

  function discard(name: string): void {
    const previous = values.get(name)
    if (!previous) return
    totalBytes -= previous.bytes
    values.delete(name)
  }

  function synchronize(graph: SceneGraph, target: PreviewTarget): boolean {
    try {
      const scope = resolveLowcodeApplicationPages(graph)
      if (scope.mode !== 'application' || scope.warnings.length) {
        clear()
        return false
      }
      const declarations = applicationStateDeclarations(
        graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []
      )
      if (!declarations) {
        clear()
        return false
      }
      if (
        ownerGraph !== graph ||
        ownerTarget !== target ||
        declarationSignature !== declarations.signature
      ) {
        clear()
        ownerGraph = graph
        ownerTarget = target
        declarationSignature = declarations.signature
      }
      declarationTypes = declarations.types
      return true
    } catch {
      clear()
      return false
    }
  }

  function accept(graph: SceneGraph, target: PreviewTarget, name: string, value: unknown): boolean {
    if (!synchronize(graph, target)) return false
    const type = declarationTypes.get(name)
    if (!type) return false
    try {
      const checked = createPreviewEditorMessage(VALIDATION_CHANNEL, {
        type: 'docState',
        name,
        value
      })
      if (checked?.type !== 'docState' || !applicationStateValueMatches(type, checked.value)) {
        discard(name)
        return false
      }
      const detached: unknown = structuredClone(checked.value)
      // Charge an extra separator per entry; this bounds the whole serialized array too.
      const bytes = encoder.encode(JSON.stringify({ name, value: detached })).byteLength + 1
      const previous = values.get(name)
      const nextBytes = totalBytes - (previous?.bytes ?? 0) + bytes
      if ((!previous && values.size >= MAX_ENTRIES) || nextBytes > MAX_BYTES) {
        discard(name)
        return false
      }
      values.set(name, { value: detached, bytes })
      totalBytes = nextBytes
      return true
    } catch {
      discard(name)
      return false
    }
  }

  function entries(graph: SceneGraph, target: PreviewTarget): ApplicationPreviewStateEntry[] {
    if (!synchronize(graph, target)) return []
    return [...values].map(([name, entry]) => ({ name, value: structuredClone(entry.value) }))
  }

  return {
    synchronize,
    accept,
    entries,
    clear
  }
}
