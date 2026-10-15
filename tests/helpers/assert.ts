import * as v from 'valibot'

import {
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

export function expectDefined<T>(value: T | null | undefined, label = 'value'): NonNullable<T> {
  if (value == null) {
    throw new Error(`${label} was expected to be defined`)
  }
  return value
}

export function getNodeOrThrow(graph: SceneGraph, id: string): SceneNode {
  return expectDefined(graph.getNode(id), `node ${id}`)
}

export function childIdAt(node: SceneNode, index: number): string {
  return expectDefined(node.childIds[index], `child ${index} of ${node.id}`)
}

/** A script-visible node's fills, failing when they read `figma.mixed`, as differently filled text does. */
export function expectFills<T>(fills: readonly T[] | symbol, label = 'fills'): readonly T[] {
  if (typeof fills === 'symbol')
    throw new Error(`${label} were expected to be one value, not mixed`)
  return fills
}

export function expectRecord(value: unknown, label = 'record'): Record<string, unknown> {
  const parsed = v.safeParse(v.record(v.string(), v.unknown()), value)
  if (!parsed.success) throw new Error(`${label} was expected to be a record`)
  return parsed.output
}

function isModuleInstance(value: unknown): value is ModuleInstanceV1 {
  return validateModuleInstance(value).ok
}

/** Validate a factory's live payload without copying it, so tampering exercises the actual node. */
export function expectModuleInstance(value: unknown): ModuleInstanceV1 {
  if (!isModuleInstance(value)) throw new Error('Expected a valid module instance')
  return value
}

export function expectString(value: unknown, label = 'string'): string {
  if (typeof value !== 'string') throw new Error(`${label} was expected to be a string`)
  return value
}
