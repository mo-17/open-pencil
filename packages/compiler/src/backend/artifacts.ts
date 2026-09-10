import {
  containsBackendSecretLikeMaterial,
  type BackendDiagnostic,
  type BackendSecretRef
} from '@open-pencil/lowcode/backend'

import { backendDiagnostic } from './diagnostics'

interface BackendArtifactPathLimits {
  readonly maxPathBytes: number
  readonly maxPathSegmentBytes: number
}

interface BackendArtifactPathCollection {
  readonly diagnostics: BackendDiagnostic[]
  readonly foldedPaths: Set<string>
}

interface BackendArtifactMetadata {
  readonly path: string
  readonly kind: string
  readonly mediaType: string
}

interface BackendArtifactOutputs {
  readonly outputs: readonly string[]
}

export function invalidBackendArtifactPath(path: string): BackendDiagnostic {
  return backendDiagnostic(
    'backend-artifact-path-invalid',
    'error',
    path,
    'Backend artifact paths must be relative, NFC-normalized portable POSIX paths.'
  )
}

type BackendArtifactContent = string | Uint8Array
function copyArtifactContent(content: BackendArtifactContent): BackendArtifactContent {
  return typeof content === 'string' ? content : content.slice()
}

export class RuntimeReadonlyBackendFiles implements ReadonlyMap<string, BackendArtifactContent> {
  readonly #files: Map<string, BackendArtifactContent>

  constructor(entries: readonly (readonly [string, BackendArtifactContent])[]) {
    this.#files = new Map(
      entries.map(([path, content]) => [path, copyArtifactContent(content)] as const)
    )
    Object.freeze(this)
  }

  get size(): number {
    return this.#files.size
  }

  get [Symbol.toStringTag](): string {
    return 'ReadonlyMap'
  }

  has(path: string): boolean {
    return this.#files.has(path)
  }

  get(path: string): BackendArtifactContent | undefined {
    const content = this.#files.get(path)
    return content === undefined ? undefined : copyArtifactContent(content)
  }

  entries(): MapIterator<[string, BackendArtifactContent]> {
    return new Map(
      [...this.#files].map(([path, content]) => [path, copyArtifactContent(content)] as const)
    ).entries()
  }

  keys(): MapIterator<string> {
    return this.#files.keys()
  }

  values(): MapIterator<BackendArtifactContent> {
    return new Map(
      [...this.#files].map(([path, content]) => [path, copyArtifactContent(content)] as const)
    ).values()
  }

  forEach(
    callback: (
      value: BackendArtifactContent,
      key: string,
      map: ReadonlyMap<string, BackendArtifactContent>
    ) => void,
    thisArg?: unknown
  ): void {
    for (const [path, content] of this.#files) {
      callback.call(thisArg, copyArtifactContent(content), path, this)
    }
  }

  [Symbol.iterator](): MapIterator<[string, BackendArtifactContent]> {
    return this.entries()
  }
}

Object.freeze(RuntimeReadonlyBackendFiles.prototype)

const WINDOWS_RESERVED_PATH = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}(?:;[ -~]{1,128})?$/u

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

function artifactPathDiagnostic(
  path: string,
  diagnosticPath: string,
  limits: BackendArtifactPathLimits
): BackendDiagnostic | undefined {
  if (
    path.length === 0 ||
    path !== path.normalize('NFC') ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':') ||
    hasControlCharacters(path)
  ) {
    return invalidBackendArtifactPath(diagnosticPath)
  }
  const encoder = new TextEncoder()
  if (encoder.encode(path).byteLength > limits.maxPathBytes) {
    return backendDiagnostic(
      'backend-artifact-path-limit',
      'error',
      diagnosticPath,
      'Backend artifact path exceeds the byte limit.'
    )
  }
  const segments = path.split('/')
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      WINDOWS_RESERVED_PATH.test(segment) ||
      encoder.encode(segment).byteLength > limits.maxPathSegmentBytes
    ) {
      return backendDiagnostic(
        'backend-artifact-path-invalid',
        'error',
        diagnosticPath,
        'Backend artifact path contains an unsafe or non-portable segment.'
      )
    }
  }
  return undefined
}

function secretKey(secret: BackendSecretRef): string {
  return secret.kind === 'credential'
    ? `${secret.kind}:${secret.credentialRef}:${secret.name}`
    : `${secret.kind}:${secret.name}`
}

export function requiredBackendArtifactSecrets(
  secrets: readonly BackendSecretRef[]
): readonly BackendSecretRef[] {
  return Object.freeze(
    secrets
      .filter((secret) => secret.required)
      .map((secret) => Object.freeze({ ...secret }))
      .sort((left, right) => secretKey(left).localeCompare(secretKey(right), 'en'))
  )
}

export function reserveBackendArtifactPath(
  collection: BackendArtifactPathCollection,
  path: string,
  diagnosticPath: string,
  limits: BackendArtifactPathLimits
): boolean {
  const invalid = artifactPathDiagnostic(path, diagnosticPath, limits)
  if (invalid) {
    collection.diagnostics.push(invalid)
    return false
  }
  const folded = path.toLowerCase()
  if (collection.foldedPaths.has(folded)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-path-conflict',
        'error',
        diagnosticPath,
        'Backend artifact path conflicts with an existing target or Provider artifact.'
      )
    )
    return false
  }
  collection.foldedPaths.add(folded)
  return true
}

/** Versioned emitters keep their reservation, content, and execution-authority checks. */
export function validateBackendArtifactMetadata(
  collection: BackendArtifactPathCollection,
  artifact: BackendArtifactMetadata,
  adapter: BackendArtifactOutputs,
  bundle: { readonly descriptor: BackendArtifactOutputs },
  path: string,
  reservePath: (path: string, diagnosticPath: string) => boolean
): boolean {
  if (typeof artifact.path !== 'string') {
    collection.diagnostics.push(invalidBackendArtifactPath(`${path}.path`))
    return false
  }
  if (containsBackendSecretLikeMaterial(artifact.path)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-metadata-secret-material-forbidden',
        'error',
        `${path}.path`,
        'Backend Provider artifact metadata cannot contain credential or secret material.'
      )
    )
    return false
  }
  if (!reservePath(artifact.path, `${path}.path`)) {
    return false
  }
  if (
    !adapter.outputs.includes(artifact.kind) ||
    !bundle.descriptor.outputs.includes(artifact.kind)
  ) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-output-undeclared',
        'error',
        `${path}.kind`,
        'Backend Provider emitted an artifact kind outside its exact declaration.'
      )
    )
    return false
  }
  if (
    typeof artifact.mediaType === 'string' &&
    containsBackendSecretLikeMaterial(artifact.mediaType)
  ) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-metadata-secret-material-forbidden',
        'error',
        `${path}.mediaType`,
        'Backend Provider artifact metadata cannot contain credential or secret material.'
      )
    )
    return false
  }
  if (typeof artifact.mediaType !== 'string' || !MEDIA_TYPE.test(artifact.mediaType)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-media-type-invalid',
        'error',
        `${path}.mediaType`,
        'Backend Provider artifact media type is invalid.'
      )
    )
    return false
  }
  return true
}
