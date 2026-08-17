export function openPencilProjectRootDefineValue(
  projectRoot: string,
  tauriPlatform: string | undefined
): string {
  return JSON.stringify(tauriPlatform ? projectRoot : '')
}
