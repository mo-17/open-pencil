import { i18n } from '#vue/i18n/create'

export const variablesMessageDefaults = {
  createCollection: 'Create collection',
  renameCollection: 'Rename collection',
  deleteCollection: 'Delete collection',
  localVariables: 'Local variables',
  noVariableCollections: 'No variable collections',
  modes: 'Modes',
  addMode: 'Add mode',
  renameMode: 'Rename mode',
  duplicateMode: 'Duplicate mode',
  deleteMode: 'Delete mode',
  setDefaultMode: 'Set as default',
  designPresets: 'Design system presets',
  presetOptional: 'Optional variable presets',
  presetIntro: 'Choose a preset, review its values, then import a new collection.',
  presetChoose: 'Choose a design preset',
  presetBusiness: 'Business',
  presetBusinessDescription: 'Blue accents and compact corners.',
  presetSoft: 'Soft',
  presetSoftDescription: 'Violet accents and rounded corners.',
  presetContrast: 'Bold contrast',
  presetContrastDescription: 'Strong color separation and small corners.',
  presetScope: 'Only adds a variable collection',
  presetScopeDescription:
    'Existing variables and nodes stay unchanged. Bind variables explicitly to use them.',
  presetCollection: 'New collection',
  presetPreview: 'Variable preview',
  presetVariable: 'Variable name',
  presetLight: 'Light',
  presetDark: 'Dark',
  presetImport: 'Import as new collection',
  presetImported: 'Preset imported',
  presetNextSteps:
    'Close this dialog and select a node. Open the variable picker beside a fill or supported numeric field to bind a variable from this collection. You can edit values or detach bindings later. Undo removes the import.',
  presetImportFailed: 'Could not import preset',
  presetRetry: 'No partial collection was kept. Try importing again.'
} as const

export const variablesMessages = i18n('variables', variablesMessageDefaults)
