import type { ModulePropertyField } from './types'

/** Build flat config fields while keeping each module's translation namespace explicit. */
export function createModuleFieldFactory(i18nNamespace: string) {
  return (
    key: string,
    kind: ModulePropertyField['kind'],
    label: string,
    extra: Partial<ModulePropertyField> = {}
  ): ModulePropertyField => ({
    path: [key],
    kind,
    label,
    i18nLabelKey: `${i18nNamespace}${key[0].toUpperCase()}${key.slice(1)}`,
    ...extra
  })
}
