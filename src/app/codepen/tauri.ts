import { isTauri } from '@/app/tauri/env'

import { parseCodePenURL, type CodePenStaticEvidence } from './contracts'
import { createCodePenStaticEvidenceFromFetchedSources } from './evidence'

export type CodePenTauriInvoker = (
  command: 'fetch_codepen_sources',
  args: Readonly<{ request: Readonly<{ url: string }> }>
) => Promise<unknown>

/**
 * Main-window adapter for the native fixed-origin fetch command. Browser use
 * fails closed, and the native result is revalidated in TypeScript before any
 * caller can pass it to AI or UI code.
 */
export async function loadCodePenStaticEvidenceFromTauri(
  penURL: string,
  invoker?: CodePenTauriInvoker
): Promise<CodePenStaticEvidence> {
  const pen = parseCodePenURL(penURL)
  if (!invoker && !isTauri()) {
    throw new Error('CodePen source analysis requires the desktop app')
  }
  let invoke = invoker
  if (!invoke) {
    const tauri = await import('@tauri-apps/api/core')
    invoke = (command, args) => tauri.invoke<unknown>(command, args)
  }
  const response = await invoke('fetch_codepen_sources', {
    request: { url: pen.url }
  })
  return createCodePenStaticEvidenceFromFetchedSources(response)
}
