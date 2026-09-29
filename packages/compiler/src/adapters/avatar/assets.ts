/** Compiler-owned binary paths let generated modules import only emitted local assets. */
export function withBundledModuleAssets<T extends object>(
  options: T,
  files: ReadonlyMap<string, string | Uint8Array>
): T & { bundledAssetPaths: readonly string[] } {
  return {
    ...options,
    bundledAssetPaths: [...files]
      .filter(([path, content]) => path.startsWith('src/assets/') && content instanceof Uint8Array)
      .map(([path]) => path)
  }
}
