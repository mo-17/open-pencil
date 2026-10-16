import { fromUint8Array } from 'js-base64'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

export function createSupabaseDigests(failed: () => never) {
  const digest = async (value: unknown): Promise<string> => {
    try {
      return await digestCanonicalManifest(value)
    } catch {
      return failed()
    }
  }
  const digestText = async (value: string): Promise<string> => {
    try {
      const bytes = new TextEncoder().encode(value)
      const source = new Uint8Array(bytes.byteLength)
      source.set(bytes)
      return fromUint8Array(new Uint8Array(await crypto.subtle.digest('SHA-256', source)), true)
    } catch {
      return failed()
    }
  }
  return { digest, digestText }
}
