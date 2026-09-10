/** Web targets supported by the desktop Backend review and staging workflow. */
export type DesktopSupabaseBackendTarget = 'react' | 'vue'

export function isDesktopSupabaseBackendTarget(
  value: unknown
): value is DesktopSupabaseBackendTarget {
  return value === 'react' || value === 'vue'
}
