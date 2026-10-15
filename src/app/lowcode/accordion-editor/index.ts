import { uniq, isEqual } from 'es-toolkit'

import type { Editor } from '@open-pencil/core/editor'
import {
  ACCORDION_MODULE_LIMITS,
  createAccordionModuleInstance,
  resolveAccordionModule,
  type AccordionItemV1
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  currentModuleEditorOwner,
  type ModuleEditorCommit
} from '@/app/lowcode/module-editor/owner'
import { nextModuleEditorItemId } from '@/app/plugins/module-items-editor-model'

/** Draft positions retain item identity even while an identifier is temporarily invalid. */
export interface AccordionEditorValue {
  items: AccordionItemV1[]
  initialOpenIndexes: number[]
  allowMultiple: boolean
}

export type AccordionItemField = 'id' | 'title' | 'content'
export type AccordionEditorEdit =
  | { kind: 'update'; index: number; field: AccordionItemField; value: string }
  | { kind: 'add'; title: string }
  | { kind: 'remove'; index: number }
  | { kind: 'move'; index: number; offset: -1 | 1 }
  | { kind: 'open'; index: number; value: boolean }
  | { kind: 'multiple'; value: boolean }

export type AccordionEditorCommit = ModuleEditorCommit<AccordionEditorValue>

export function accordionPropertyVisible(key: string): boolean {
  return key !== 'initialOpenIds' && key !== 'allowMultiple'
}

export function copyAccordionEditor(value: AccordionEditorValue): AccordionEditorValue {
  return {
    items: value.items.map(({ id, title, content }) => ({ id, title, content })),
    initialOpenIndexes: [...value.initialOpenIndexes],
    allowMultiple: value.allowMultiple
  }
}

export function accordionEditorValue(config: JSONObject): AccordionEditorValue {
  const resolved = resolveAccordionModule(createAccordionModuleInstance(config))
  if (!resolved?.ok) throw new Error('Invalid accordion configuration')
  return {
    items: resolved.config.items.map(({ id, title, content }) => ({ id, title, content })),
    initialOpenIndexes: resolved.config.items.flatMap((item, index) =>
      resolved.config.initialOpenIds.includes(item.id) ? [index] : []
    ),
    allowMultiple: resolved.config.allowMultiple
  }
}

export function editAccordionEditor(
  current: AccordionEditorValue,
  edit: AccordionEditorEdit
): AccordionEditorValue {
  if (edit.kind === 'multiple')
    return {
      ...current,
      allowMultiple: edit.value,
      initialOpenIndexes: edit.value
        ? [...current.initialOpenIndexes]
        : [...current.initialOpenIndexes].sort((a, b) => a - b).slice(0, 1)
    }
  const items = [...current.items]
  const openItems = new Set(current.initialOpenIndexes.map((index) => items[index]))
  if (edit.kind === 'add') {
    if (items.length >= ACCORDION_MODULE_LIMITS.itemsMax) return current
    items.push({ id: nextModuleEditorItemId(items, 'section'), title: edit.title, content: '' })
  } else {
    if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= items.length)
      return current
    if (edit.kind === 'open') {
      if (!edit.value)
        return {
          ...current,
          initialOpenIndexes: current.initialOpenIndexes.filter((index) => index !== edit.index)
        }
      const initialOpenIndexes = current.allowMultiple
        ? uniq([...current.initialOpenIndexes, edit.index]).sort((a, b) => a - b)
        : [edit.index]
      return { ...current, initialOpenIndexes }
    }
    if (edit.kind === 'update') {
      items[edit.index] = { ...items[edit.index], [edit.field]: edit.value }
      return { ...current, items }
    }
    if (edit.kind === 'remove') {
      if (items.length <= ACCORDION_MODULE_LIMITS.itemsMin) return current
      items.splice(edit.index, 1)
    } else {
      const target = edit.index + edit.offset
      if (target < 0 || target >= items.length) return current
      ;[items[edit.index], items[target]] = [items[target], items[edit.index]]
    }
  }
  return {
    ...current,
    items,
    initialOpenIndexes: items.flatMap((item, index) => (openItems.has(item) ? [index] : []))
  }
}

function moduleFromDraft(config: JSONObject, value: AccordionEditorValue) {
  if (
    new Set(value.initialOpenIndexes).size !== value.initialOpenIndexes.length ||
    value.initialOpenIndexes.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= value.items.length
    )
  )
    throw new TypeError('Invalid accordion initial selection')
  return createAccordionModuleInstance({
    ...config,
    items: value.items.map(({ id, title, content }) => ({ id, title, content })),
    allowMultiple: value.allowMultiple,
    initialOpenIds: value.initialOpenIndexes.map((index) => value.items[index].id)
  })
}

export function validAccordionEditor(config: JSONObject, value: AccordionEditorValue): boolean {
  try {
    moduleFromDraft(config, value)
    return true
  } catch {
    return false
  }
}

type AccordionEditor = Pick<Editor, 'graph' | 'state' | 'updateNodeWithUndo'>

export function commitAccordionEditor(
  editor: AccordionEditor,
  request: AccordionEditorCommit
): boolean {
  const { previousModule, value } = request
  const owner = currentModuleEditorOwner(editor, request)
  if (!owner) return false
  const resolved = resolveAccordionModule(previousModule)
  if (!resolved?.ok || !validAccordionEditor(resolved.config, value)) return false
  const module = moduleFromDraft(resolved.config, value)
  if (isEqual(module, previousModule)) return true
  editor.updateNodeWithUndo(
    owner.id,
    { interactiveProps: { ...owner.interactiveProps, module } },
    'Update accordion items'
  )
  return true
}
