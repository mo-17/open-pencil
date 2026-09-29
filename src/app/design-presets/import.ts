import type { Editor } from '@open-pencil/core/editor'
import { randomHex } from '@open-pencil/core/random'
import type { Variable, VariableCollection } from '@open-pencil/scene-graph'

import { getDesignPresetTokens, type DesignPresetId } from './catalog'

export interface DesignPresetImportLabels {
  collectionName: string
  light: string
  dark: string
  undo: string
}

export function designPresetCollectionName(editor: Editor, baseName: string): string {
  const names = new Set(editor.getCollections().map((collection) => collection.name))
  let candidate = baseName
  let suffix = 2
  while (names.has(candidate)) candidate = `${baseName} (${suffix++})`
  return candidate
}

/** Imports only new variable records. It never binds or restyles existing nodes. */
export function importDesignPreset(
  editor: Editor,
  id: DesignPresetId,
  labels: DesignPresetImportLabels
): VariableCollection {
  const collection: VariableCollection = {
    id: `col:${randomHex(16)}`,
    name: designPresetCollectionName(editor, labels.collectionName),
    modes: [
      { modeId: 'light', name: labels.light },
      { modeId: 'dark', name: labels.dark }
    ],
    defaultModeId: 'light',
    variableIds: []
  }
  const variables = getDesignPresetTokens(id).map((token): Variable => ({
    id: `var:${randomHex(16)}`,
    collectionId: collection.id,
    name: `${collection.name}/${token.name}`,
    type: token.type,
    valuesByMode: { light: token.light, dark: token.dark },
    description: '',
    hiddenFromPublishing: false
  }))

  editor.undo.runBatch(labels.undo, () => {
    editor.addCollection(collection)
    for (const variable of variables) editor.addVariable(variable)
  })
  return collection
}
