import type { OpenPencilMicrofrontendRuntimeModuleV1 } from './types'

const RUNTIME_EXPORTS = Object.freeze(['bootstrap', 'mount', 'update', 'unmount'] as const)
const RUNTIME_EXPORT_SET = new Set<string>(RUNTIME_EXPORTS)

const GENERATED_MICROFRONTEND_TYPES = `export const OPENPENCIL_MICROFRONTEND_ABI_V1 = 'openpencil.microfrontend.v1' as const

export interface OpenPencilMicrofrontendLocationV1 {
  pathname: string
  search: string
  hash: string
}

export type OpenPencilMicrofrontendEventHandlerV1 = (payload: unknown) => void

export interface OpenPencilMicrofrontendEventBusV1 {
  publish(topic: string, payload: unknown): void
  subscribe(topic: string, handler: OpenPencilMicrofrontendEventHandlerV1): () => void
}

export interface OpenPencilMicrofrontendHostContextV1 {
  appId: string
  basePath: string
  portalTarget: HTMLElement
  location: OpenPencilMicrofrontendLocationV1
  navigate(to: string): void
  events: OpenPencilMicrofrontendEventBusV1
}

export interface OpenPencilMicrofrontendRuntimeModuleV1 {
  bootstrap(): Promise<void>
  mount(container: HTMLElement, context: OpenPencilMicrofrontendHostContextV1): Promise<void>
  update(context: OpenPencilMicrofrontendHostContextV1): Promise<void>
  unmount(): Promise<void>
}
`

/** Self-contained ABI types written into generated apps; it has no compiler-package import. */
export function buildOpenPencilMicrofrontendTypes(): string {
  return GENERATED_MICROFRONTEND_TYPES
}

/**
 * Validate the direct same-realm ESM namespace before invoking untrusted-shaped
 * dynamic-import output. Extra string exports are rejected so ABI drift is
 * visible instead of being silently ignored. The standard module namespace
 * Symbol.toStringTag property is intentionally ignored.
 */
export function parseOpenPencilMicrofrontendRuntimeModule(
  value: unknown
): OpenPencilMicrofrontendRuntimeModuleV1 {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new TypeError('microfrontend runtime module must be an ESM namespace object')
  }
  const ownKeys = Reflect.ownKeys(value)
  const stringKeys = ownKeys.filter((key): key is string => typeof key === 'string')
  if (
    stringKeys.length !== RUNTIME_EXPORTS.length ||
    stringKeys.some((key) => !RUNTIME_EXPORT_SET.has(key)) ||
    ownKeys.some((key) => typeof key === 'symbol' && key !== Symbol.toStringTag)
  ) {
    throw new TypeError(
      'microfrontend runtime module must export exactly bootstrap, mount, update, and unmount'
    )
  }
  for (const name of RUNTIME_EXPORTS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`microfrontend runtime module.${name} must be a data-property function`)
    }
  }
  return value as OpenPencilMicrofrontendRuntimeModuleV1
}

export function isOpenPencilMicrofrontendRuntimeModule(
  value: unknown
): value is OpenPencilMicrofrontendRuntimeModuleV1 {
  try {
    parseOpenPencilMicrofrontendRuntimeModule(value)
    return true
  } catch {
    return false
  }
}
