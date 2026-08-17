import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  fetchBundledFontBytes as fetchBundledFontFromWebRuntime,
  isBundledFontWebRuntime
} from './bundled-font-loader.browser'

export { MAX_BUNDLED_FONT_WORKER_BYTES } from './bundled-font-loader.browser'

/** Bun/Node entrypoint. Vite aliases this module to the browser-only implementation. */
export async function fetchBundledFontBytes(value: string): Promise<ArrayBuffer> {
  if (isBundledFontWebRuntime()) return fetchBundledFontFromWebRuntime(value)
  const packageJSONURL = import.meta.resolve('@open-pencil/core/package.json')
  const packageRoot = dirname(fileURLToPath(packageJSONURL))
  const assetPath = resolve(packageRoot, `assets${value}`)
  const buffer = await readFile(assetPath)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}
