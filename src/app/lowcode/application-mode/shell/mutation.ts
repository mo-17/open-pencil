import { resolveLowcodeApplicationShell, validateLowcodeApplication } from '@open-pencil/lowcode'

import { applicationDocumentEditable, applicationRawEntry } from '../model'
import { updateApplicationConfiguration } from '../mutation'
import type { ApplicationModeEditor } from '../types'

/** Explicitly replace or remove the complete pair; never persist a half-configured shell. */
export function setApplicationShell(
  editor: ApplicationModeEditor,
  shell: unknown,
  label: string
): boolean {
  if (!applicationDocumentEditable(editor.graph)) return false
  const root = editor.graph.getNode(editor.graph.rootId)
  const current = validateLowcodeApplication(root?.lowcodeApplication)
  if (!root || !current.ok || !current.value.enabled) return false
  if (root.pluginData.some((entry) => applicationRawEntry(entry, false))) return false
  const nextValue = { ...current.value }
  delete nextValue.shell
  const next = validateLowcodeApplication(shell === undefined ? nextValue : { ...nextValue, shell })
  if (!next.ok) return false
  if (next.value.shell && !resolveLowcodeApplicationShell(editor.graph, next.value.shell).ok)
    return false
  return updateApplicationConfiguration(
    editor,
    root,
    { lowcodeApplication: next.value },
    false,
    label
  )
}
