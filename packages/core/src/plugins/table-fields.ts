import type { ModulePropertyField } from './types'

/** Identical table inspector metadata shared by the basic table and typed data grid. */
export const TABLE_HEADER_FIELD: ModulePropertyField = Object.freeze({
  path: Object.freeze(['showHeader']),
  kind: 'boolean',
  label: 'Show header',
  i18nLabelKey: 'lowcodeModuleFieldShowHeader'
})

const appearanceFields: ModulePropertyField[] = [
  {
    path: ['striped'],
    kind: 'boolean',
    label: 'Striped rows',
    i18nLabelKey: 'lowcodeModuleFieldStriped'
  },
  {
    path: ['borderColor'],
    kind: 'color',
    label: 'Border color',
    i18nLabelKey: 'lowcodeModuleFieldBorderColor'
  },
  {
    path: ['headerBackground'],
    kind: 'color',
    label: 'Header background',
    i18nLabelKey: 'lowcodeModuleFieldHeaderBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldTextColor'
  }
]
for (const field of appearanceFields) {
  Object.freeze(field.path)
  Object.freeze(field)
}
export const TABLE_APPEARANCE_FIELDS: readonly ModulePropertyField[] =
  Object.freeze(appearanceFields)
