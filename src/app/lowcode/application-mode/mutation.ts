import { isEqual } from 'es-toolkit'

import { validateLowcodeApplication, validateLowcodeApplicationPage } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  applicationDocumentEditable,
  applicationEntryEligible,
  applicationPageEditable,
  applicationRawEntry,
  applicationRouteValid,
  applicationStartEligible,
  applicationStartRouteValid
} from './model'
import type { ApplicationModeEditor } from './types'

function currentPage(editor: ApplicationModeEditor, page: SceneNode): boolean {
  return (
    editor.graph.getNode(editor.state.currentPageId) === page &&
    applicationPageEditable(editor.graph, page)
  )
}

function applicationEnabled(editor: ApplicationModeEditor): boolean {
  const root = editor.graph.getNode(editor.graph.rootId)
  const result = validateLowcodeApplication(root?.lowcodeApplication)
  return (
    result.ok &&
    result.value.enabled &&
    !root?.pluginData.some((entry) => applicationRawEntry(entry, false))
  )
}

export function updateApplicationConfiguration(
  editor: ApplicationModeEditor,
  node: SceneNode,
  changes: Partial<SceneNode>,
  page: boolean,
  label: string
): boolean {
  const raw = node.pluginData.some((entry) => applicationRawEntry(entry, page))
  if (
    !raw &&
    Object.entries(changes).every(([key, value]) => isEqual(Reflect.get(node, key), value))
  )
    return false
  editor.updateNodeWithUndo(
    node.id,
    {
      ...changes,
      ...(raw
        ? { pluginData: node.pluginData.filter((entry) => !applicationRawEntry(entry, page)) }
        : {})
    },
    label
  )
  return true
}

export function setApplicationEnabled(
  editor: ApplicationModeEditor,
  enabled: unknown,
  label: string
): boolean {
  if (typeof enabled !== 'boolean' || !applicationDocumentEditable(editor.graph)) return false
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) return false
  const current = validateLowcodeApplication(root.lowcodeApplication)
  const next = validateLowcodeApplication({
    ...(current.ok ? current.value : { version: 1 }),
    version: 1,
    enabled
  })
  if (!next.ok) return false
  return updateApplicationConfiguration(
    editor,
    root,
    { lowcodeApplication: next.value },
    false,
    label
  )
}

export function setApplicationRole(
  editor: ApplicationModeEditor,
  page: SceneNode,
  role: unknown,
  label: string
): boolean {
  if (!currentPage(editor, page) || !applicationEnabled(editor)) return false
  if (role === '')
    return updateApplicationConfiguration(
      editor,
      page,
      { lowcodeApplicationPage: undefined },
      true,
      label
    )
  const current = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
  const value = { ...(current.ok ? structuredClone(current.value) : {}), version: 1, role }
  if (role !== 'application') delete value.entryNodeId
  const next = validateLowcodeApplicationPage(value)
  if (!next.ok) return false
  return updateApplicationConfiguration(
    editor,
    page,
    { lowcodeApplicationPage: next.value },
    true,
    label
  )
}

export function setApplicationEntry(
  editor: ApplicationModeEditor,
  page: SceneNode,
  id: unknown,
  label: string
): boolean {
  if (typeof id !== 'string' || !currentPage(editor, page) || !applicationEnabled(editor))
    return false
  const current = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
  if (!current.ok || current.value.role !== 'application') return false
  if (id && !applicationEntryEligible(editor.graph, page, editor.graph.getNode(id))) return false
  const nextValue = structuredClone(current.value)
  if (id) nextValue.entryNodeId = id
  else delete nextValue.entryNodeId
  const next = validateLowcodeApplicationPage(nextValue)
  if (!next.ok) return false
  return updateApplicationConfiguration(
    editor,
    page,
    { lowcodeApplicationPage: next.value },
    true,
    label
  )
}

export function setApplicationStart(
  editor: ApplicationModeEditor,
  id: unknown,
  label: string
): boolean {
  if (
    typeof id !== 'string' ||
    !applicationDocumentEditable(editor.graph) ||
    !applicationEnabled(editor)
  )
    return false
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) return false
  const page = editor.graph.getNode(id)
  if (
    id &&
    (!page || !applicationStartEligible(editor.graph, page) || !applicationStartRouteValid(page))
  )
    return false
  const current = validateLowcodeApplication(root.lowcodeApplication)
  if (!current.ok) return false
  const nextValue = { ...current.value }
  if (id) nextValue.startPageId = id
  else delete nextValue.startPageId
  const next = validateLowcodeApplication(nextValue)
  if (!next.ok) return false
  return updateApplicationConfiguration(
    editor,
    root,
    { lowcodeApplication: next.value },
    false,
    label
  )
}

export function setApplicationRoute(
  editor: ApplicationModeEditor,
  page: SceneNode,
  value: unknown,
  label: string
): boolean {
  if (!applicationRouteValid(value) || !currentPage(editor, page) || !applicationEnabled(editor))
    return false
  const current = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
  if (
    !current.ok ||
    current.value.role !== 'application' ||
    page.pluginData.some((entry) => applicationRawEntry(entry, true))
  )
    return false
  const route = value === '' ? undefined : value
  if (page.lowcodeRoutePattern === route) return false
  editor.updateNodeWithUndo(page.id, { lowcodeRoutePattern: route }, label)
  return true
}

/** Persist only a declarative policy; preview/runtime values never enter the document graph. */
export function setApplicationStateRetention(
  editor: ApplicationModeEditor,
  page: SceneNode,
  value: unknown,
  label: string
): boolean {
  if (
    (value !== 'reset' && value !== 'preserve') ||
    !currentPage(editor, page) ||
    !applicationEnabled(editor) ||
    page.pluginData.some((entry) => applicationRawEntry(entry, true))
  )
    return false
  const current = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
  if (!current.ok || current.value.role !== 'application') return false
  if (current.value.stateRetention === value) return false
  const nextValue = structuredClone(current.value)
  nextValue.stateRetention = value
  const next = validateLowcodeApplicationPage(nextValue)
  if (!next.ok) return false
  return updateApplicationConfiguration(
    editor,
    page,
    { lowcodeApplicationPage: next.value },
    true,
    label
  )
}
