import type { CSSOMRuntime } from '../cssom'

const HEADLESS_CSSOM_PACKAGE = '@acemir/cssom'

/** Node/Bun only; browser paths use the native CSS object model. */
export async function loadHeadlessCSSOM(): Promise<CSSOMRuntime> {
  // The dependency's browser entry is a global script. Keep the Node implementation out of
  // browser chunks, including lazy chunks, rather than resolving its empty UMD exports.
  const runtime: CSSOMRuntime = await import(/* @vite-ignore */ HEADLESS_CSSOM_PACKAGE)
  return runtime
}
