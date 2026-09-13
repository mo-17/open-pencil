import {
  BACKEND_LIMITS,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import type { CompilerBackendProviderRequest } from '../types'
import { createBuiltinBackendProviderRegistry } from './builtins'
import {
  backendSha256,
  canonicalBackendValue,
  digestCanonicalBackendValue,
  freezeBackendValue
} from './canonical'
import type { BackendProviderSelection } from './contracts'
import { parseBackendProviderDescriptor, sameBackendProviderDescriptor } from './descriptor'
import { emitBackendProviderPlan } from './emit'
import { createBackendProviderPlan } from './plan'

export const BACKEND_PROVIDER_COMPILE_HANDOFF_MAX_BYTES = BACKEND_LIMITS.maxCanonicalBytes
export const BACKEND_PROVIDER_DECLARATION_MAX_BYTES = BACKEND_LIMITS.maxCanonicalBytes + 256 * 1024
export const BACKEND_PROVIDER_DEPLOY_READY_PREFIX = 'OPENPENCIL_BACKEND_READY '

const COMPILE_FORMAT = 'openpencil.backend-provider-compile.v1'
const DECLARATION_FORMAT = 'openpencil.backend-provider-request.v1'
const DEPLOY_FORMAT = 'openpencil.backend-provider-deploy.v1'
const DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

/**
 * Explicit process input bound to a document declaration and deterministic artifacts.
 * This does not authenticate an App installation, lifecycle, or release approval.
 */
export interface BackendProviderCompileHandoff {
  readonly format: typeof COMPILE_FORMAT
  readonly declarationDigest: string
  readonly request: CompilerBackendProviderRequest
  readonly target: 'react' | 'vue'
  readonly mode: 'production'
  readonly planDigest: string
  readonly manifestDigest: string
}

export interface CreateBackendProviderCompileHandoffInput {
  readonly declaration: string
  readonly selection: BackendProviderSelection
  readonly application: BackendApplicationSpecV1
  readonly target: 'react' | 'vue'
  readonly planDigest: string
  readonly manifestDigest: string
}

/** Process-local deploy coordination; never a Backend Apply or live verification receipt. */
export interface BackendProviderDeployMessage {
  readonly format: typeof DEPLOY_FORMAT
  readonly stage: 'ready' | 'authorize' | 'cancel'
  readonly handoffDigest: string
  readonly dispatchDigest: string
  readonly challenge: string
}

function invalidHandoff(): never {
  throw new TypeError('Invalid Backend Provider compile handoff.')
}

function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalidHandoff()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return invalidHandoff()
  const ownKeys = Reflect.ownKeys(value)
  if (
    keys &&
    (ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key)))
  ) {
    return invalidHandoff()
  }
  const data: Record<string, unknown> = {}
  for (const key of ownKeys) {
    if (typeof key !== 'string') return invalidHandoff()
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalidHandoff()
    Object.defineProperty(data, key, { value: descriptor.value, enumerable: true })
  }
  return data
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) return invalidHandoff()
  return value
}

function declarationString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > BACKEND_PROVIDER_DECLARATION_MAX_BYTES ||
    new TextEncoder().encode(value).byteLength > BACKEND_PROVIDER_DECLARATION_MAX_BYTES
  ) {
    return invalidHandoff()
  }
  return value
}

function checkedHandoff(value: unknown): BackendProviderCompileHandoff {
  const source = record(canonicalBackendValue(value, '$.handoff'), [
    'format',
    'declarationDigest',
    'request',
    'target',
    'mode',
    'planDigest',
    'manifestDigest'
  ])
  if (
    source.format !== COMPILE_FORMAT ||
    (source.target !== 'react' && source.target !== 'vue') ||
    source.mode !== 'production'
  ) {
    return invalidHandoff()
  }
  const declarationDigest = digest(source.declarationDigest)
  const planDigest = digest(source.planDigest)
  const manifestDigest = digest(source.manifestDigest)
  const request = record(source.request, ['selection', 'application'])
  const registry = createBuiltinBackendProviderRegistry()
  // Registry resolution validates the exact data shape and package selection at runtime.
  const resolved = registry.resolve(request.selection as BackendProviderSelection)
  if (!resolved.ok) return invalidHandoff()
  const planned = createBackendProviderPlan(registry, {
    selection: resolved.value.selection,
    application: request.application,
    target: source.target,
    mode: 'production'
  })
  if (!planned.ok || planned.plan.planDigest !== planDigest) return invalidHandoff()
  const emitted = emitBackendProviderPlan(registry, {
    selection: resolved.value.selection,
    plan: planned.plan
  })
  if (!emitted.ok || emitted.emission.manifestDigest !== manifestDigest) return invalidHandoff()
  const frame: BackendProviderCompileHandoff = {
    format: COMPILE_FORMAT,
    declarationDigest,
    request: { selection: resolved.value.selection, application: planned.plan.application },
    target: source.target,
    mode: 'production',
    planDigest,
    manifestDigest
  }
  canonicalBackendValue(frame, '$.handoff')
  return freezeBackendValue(frame)
}

function assertDeclarationBinding(frame: BackendProviderCompileHandoff, declaration: string): void {
  const raw = declarationString(declaration)
  if (backendSha256(raw) !== frame.declarationDigest) return invalidHandoff()
  const source = record(JSON.parse(raw), ['format', 'selection', 'application'])
  if (source.format !== DECLARATION_FORMAT) return invalidHandoff()
  const selection = record(source.selection)
  const authority = record(selection.packageAuthority)
  // Only the portable Compiler projection is interpreted here. Host-only authority
  // fields remain bound by the raw digest and must be reviewed by the live App host.
  const descriptor = parseBackendProviderDescriptor({
    pluginId: selection.pluginId,
    contributionId: selection.contributionId,
    providerId: selection.providerId,
    adapterId: selection.adapterId,
    adapterVersion: selection.adapterVersion,
    contractVersion: selection.contractVersion,
    supportedModelVersions: selection.supportedModelVersions,
    capabilities: selection.capabilities,
    outputs: selection.outputKinds
  })
  if (
    !descriptor.ok ||
    !sameBackendProviderDescriptor(descriptor.value, frame.request.selection.descriptor) ||
    authority.packageDigest !== frame.request.selection.packageDigest
  ) {
    return invalidHandoff()
  }
  const application = parseBackendApplicationSpecV1(source.application)
  if (
    !application.ok ||
    digestCanonicalBackendValue(application.value, '$.application') !==
      digestCanonicalBackendValue(frame.request.application, '$.application')
  ) {
    return invalidHandoff()
  }
}

export function parseBackendProviderCompileHandoff(value: unknown): BackendProviderCompileHandoff {
  try {
    return checkedHandoff(value)
  } catch {
    return invalidHandoff()
  }
}

export function createBackendProviderCompileHandoff(
  input: CreateBackendProviderCompileHandoffInput
): BackendProviderCompileHandoff {
  try {
    const source = record(input, [
      'declaration',
      'selection',
      'application',
      'target',
      'planDigest',
      'manifestDigest'
    ])
    const declaration = declarationString(source.declaration)
    const frame = checkedHandoff({
      format: COMPILE_FORMAT,
      declarationDigest: backendSha256(declaration),
      request: { selection: source.selection, application: source.application },
      target: source.target,
      mode: 'production',
      planDigest: source.planDigest,
      manifestDigest: source.manifestDigest
    })
    assertDeclarationBinding(frame, declaration)
    return frame
  } catch {
    return invalidHandoff()
  }
}

export function resolveBackendProviderCompileHandoff(
  value: unknown,
  declaration: string,
  target: 'react' | 'vue'
): CompilerBackendProviderRequest {
  try {
    const frame = checkedHandoff(value)
    if (frame.target !== target) return invalidHandoff()
    assertDeclarationBinding(frame, declaration)
    return frame.request
  } catch {
    return invalidHandoff()
  }
}

export function digestBackendProviderCompileHandoff(value: unknown): string {
  try {
    return digestCanonicalBackendValue(checkedHandoff(value), '$.handoff')
  } catch {
    return invalidHandoff()
  }
}

export function parseBackendProviderDeployMessage(value: unknown): BackendProviderDeployMessage {
  try {
    const source = record(canonicalBackendValue(value, '$.deploy'), [
      'format',
      'stage',
      'handoffDigest',
      'dispatchDigest',
      'challenge'
    ])
    if (
      source.format !== DEPLOY_FORMAT ||
      (source.stage !== 'ready' && source.stage !== 'authorize' && source.stage !== 'cancel') ||
      typeof source.challenge !== 'string' ||
      !UUID.test(source.challenge)
    ) {
      return invalidHandoff()
    }
    return Object.freeze({
      format: DEPLOY_FORMAT,
      stage: source.stage,
      handoffDigest: digest(source.handoffDigest),
      dispatchDigest: digest(source.dispatchDigest),
      challenge: source.challenge
    })
  } catch {
    throw new TypeError('Invalid Backend Provider deploy message.')
  }
}
