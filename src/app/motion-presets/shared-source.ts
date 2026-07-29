import {
  loadSharedMotionPresetManifestSource,
  type SharedMotionPresetFetchResponse,
  type SharedMotionPresetManifest,
  type SharedMotionPresetSource
} from '@open-pencil/scene-graph'

import { isTauri } from '@/app/tauri/env'

export type AppMotionPresetSourceResponse = SharedMotionPresetFetchResponse

export interface AppMotionPresetSourceDependencies {
  readonly fetch?: (url: string) => Promise<AppMotionPresetSourceResponse>
  readonly readFile?: (path: string) => Promise<Uint8Array>
  readonly stat?: (path: string) => Promise<{ size: number }>
  readonly desktop?: boolean
}

function assertTransportSize(size: number, maxBytes: number): void {
  if (!Number.isFinite(size) || size < 0 || size > maxBytes) {
    throw new Error(`content may not exceed ${maxBytes} bytes`)
  }
}

/** Retrieve a shared manifest without accepting it. Dependencies are injectable for app tests. */
export async function readSharedMotionPresetManifestSource(
  source: SharedMotionPresetSource,
  dependencies: AppMotionPresetSourceDependencies = {}
): Promise<SharedMotionPresetManifest> {
  const desktop = dependencies.desktop ?? isTauri()
  const shouldLoadDesktopFs = !(dependencies.readFile && dependencies.stat) && desktop
  const fs = shouldLoadDesktopFs ? await import('@tauri-apps/plugin-fs') : null
  const read = dependencies.readFile ?? fs?.readFile
  const inspect = dependencies.stat ?? fs?.stat
  const request =
    dependencies.fetch ?? ((url: string) => fetch(url, { signal: AbortSignal.timeout(10_000) }))
  return loadSharedMotionPresetManifestSource(source, {
    readFile:
      read && inspect
        ? async (ref, maxBytes) => {
            const fileStat = await inspect(ref)
            assertTransportSize(fileStat.size, maxBytes)
            return read(ref)
          }
        : undefined,
    fetchUrl: (ref) => request(ref)
  })
}
