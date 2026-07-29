import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  loadSharedMotionPresetManifestSource,
  type SharedMotionPresetFetchResponse,
  type SharedMotionPresetManifest,
  type SharedMotionPresetSource
} from '@open-pencil/scene-graph'

export type MotionPresetSourceResponse = SharedMotionPresetFetchResponse

export interface MotionPresetSourceReaderDependencies {
  readonly readFile?: (path: string) => Promise<Uint8Array>
  readonly stat?: (path: string) => Promise<{ size: number }>
  readonly fetch?: (url: string) => Promise<MotionPresetSourceResponse>
}

function assertTransportSize(size: number, maxBytes: number): void {
  if (!Number.isFinite(size) || size < 0 || size > maxBytes) {
    throw new Error(`content may not exceed ${maxBytes} bytes`)
  }
}

function canonicalSource(source: SharedMotionPresetSource): SharedMotionPresetSource {
  if (source.kind === 'file') return { kind: 'file', ref: resolve(source.ref) }
  return source
}

async function defaultFetch(url: string): Promise<MotionPresetSourceResponse> {
  return fetch(url, { signal: AbortSignal.timeout(10_000) })
}

export function parseMotionPresetSource(kind: string, ref: string): SharedMotionPresetSource {
  if (kind !== 'file' && kind !== 'url') {
    throw new Error(`Unknown shared motion preset source kind "${kind}". Expected file or url.`)
  }
  return canonicalSource({ kind, ref })
}

/** Read one manifest with injectable file/network dependencies for deterministic tests. */
export function readSharedMotionPresetSource(
  sourceValue: SharedMotionPresetSource,
  dependencies: MotionPresetSourceReaderDependencies = {}
): Promise<SharedMotionPresetManifest> {
  const source = canonicalSource(sourceValue)
  const read = dependencies.readFile ?? readFile
  const inspect = dependencies.stat ?? stat
  const request = dependencies.fetch ?? defaultFetch
  return loadSharedMotionPresetManifestSource(source, {
    readFile: async (ref, maxBytes) => {
      const fileStat = await inspect(ref)
      assertTransportSize(fileStat.size, maxBytes)
      return read(ref)
    },
    fetchUrl: (ref) => request(ref)
  })
}
