import type { LibraryComponentManifestEntry, LibraryManifest } from './libraries'
import { requireExactJSONObject } from './module'

export const REMOTE_COMPONENT_LIBRARY_FORMAT = 'openpencil.component-library' as const
export const REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION = 1 as const

export const REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS = Object.freeze({
  maxComponents: 512,
  maxLibraryIdLength: 256,
  maxComponentKeyLength: 256,
  maxNodeIdLength: 256,
  maxVersionLength: 128,
  maxNameLength: 256
})

export type RemoteComponentLibraryDescriptor = Pick<
  LibraryManifest,
  'libraryId' | 'name' | 'components'
>

type JSONRecord = Record<string, unknown>

const DESCRIPTOR_KEYS = ['libraryId', 'name', 'components'] as const
const COMPONENT_KEYS = ['key', 'name', 'version', 'nodeId', 'type'] as const

/**
 * Parse the transport-neutral identity and component table shared by remote
 * component-library producers and consumers. URL, media type, artifact format,
 * and byte limits remain the responsibility of their transport/codec owners.
 */
export function parseRemoteComponentLibraryDescriptor(
  value: unknown,
  path = 'manifest',
  options: Readonly<{ allowExtraKeys?: boolean }> = {}
): RemoteComponentLibraryDescriptor {
  const descriptor = options.allowExtraKeys
    ? requiredRecord(value, DESCRIPTOR_KEYS, path)
    : requireExactJSONObject(value, DESCRIPTOR_KEYS, path)
  return {
    libraryId: boundedString(
      descriptor.libraryId,
      `${path}.libraryId`,
      REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxLibraryIdLength
    ),
    name: boundedString(
      descriptor.name,
      `${path}.name`,
      REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxNameLength
    ),
    components: parseComponents(descriptor.components, path)
  }
}

function parseComponents(value: unknown, path: string): LibraryComponentManifestEntry[] {
  const componentPath = `${path}.components`
  if (!Array.isArray(value)) throw new TypeError(`${componentPath} must be an array`)
  if (value.length === 0) {
    throw new TypeError(`${componentPath} must contain at least one entry`)
  }
  if (value.length > REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxComponents) {
    throw new TypeError(
      `${componentPath} must not contain more than ${REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxComponents} entries`
    )
  }

  const keys = new Set<string>()
  const nodeIds = new Set<string>()
  return value.map((component, index) => {
    const entryPath = `${componentPath}[${index}]`
    const parsed = requireExactJSONObject(component, COMPONENT_KEYS, entryPath)
    if (parsed.type !== 'COMPONENT' && parsed.type !== 'COMPONENT_SET') {
      throw new TypeError(`${entryPath}.type must be COMPONENT or COMPONENT_SET`)
    }
    const key = boundedString(
      parsed.key,
      `${entryPath}.key`,
      REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxComponentKeyLength
    )
    const nodeId = boundedString(
      parsed.nodeId,
      `${entryPath}.nodeId`,
      REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxNodeIdLength
    )
    if (keys.has(key)) throw new TypeError(`${componentPath} contains duplicate key "${key}"`)
    if (nodeIds.has(nodeId)) {
      throw new TypeError(`${componentPath} contains duplicate nodeId "${nodeId}"`)
    }
    keys.add(key)
    nodeIds.add(nodeId)
    return {
      key,
      name: boundedString(
        parsed.name,
        `${entryPath}.name`,
        REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxNameLength
      ),
      version: boundedString(
        parsed.version,
        `${entryPath}.version`,
        REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxVersionLength
      ),
      nodeId,
      type: parsed.type
    }
  })
}

function requiredRecord(value: unknown, keys: readonly string[], path: string): JSONRecord {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`)
  const missingKeys = keys.filter((key) => !Object.hasOwn(value, key))
  if (missingKeys.length > 0) {
    throw new TypeError(`${path} must contain: ${keys.join(', ')}`)
  }
  return value
}

function isRecord(value: unknown): value is JSONRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${path} must be a non-empty string`)
  }
  if (value.length > maxLength) {
    throw new TypeError(`${path} must not exceed ${maxLength} characters`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      throw new TypeError(`${path} must not contain control characters`)
    }
  }
  return value
}
