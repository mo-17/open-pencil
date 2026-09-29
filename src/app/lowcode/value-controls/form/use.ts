import { isPlainObject } from 'es-toolkit/predicate'
import { computed } from 'vue'

import { moduleValueFields } from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useRetainedActivity, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { currentModuleEditorOwner } from '@/app/lowcode/module-editor/owner'

import {
  moduleBindingFromSelection,
  moduleBindingOptions,
  moduleBindingSelection,
  type ModuleValueKey
} from './fields'
import { useModuleValueSession } from './session'

export function useModuleValueBindings() {
  const editor = useEditorStore()
  const { panels } = useI18n()
  const { selectedNode } = useSelectionState()
  const owner = useSceneComputed(() => {
    const node = selectedNode.value ? editor.graph.getNode(selectedNode.value.id) : undefined
    return node && moduleValueFields(node).length ? node : undefined
  })
  const source = useSceneComputed(() => ({
    bindings: owner.value?.bindings,
    props: owner.value?.interactiveProps
  }))
  const session = useModuleValueSession(
    () => owner.value,
    () => source.value,
    useRetainedActivity()
  )
  const rows = computed(() => {
    const node = owner.value
    if (!node) return []
    void source.value
    return moduleValueFields(node).map((field) => {
      const options = moduleBindingOptions(
        editor.graph,
        node,
        editor.state.currentPageId,
        field,
        panels.value.lowcodeTextSourceBound,
        panels.value.lowcodeTextSourceDocState
      )
      const selected = moduleBindingSelection(node.bindings?.[field.key], options)
      const raw = node.interactiveProps?.[field.validationKey]
      const validation: JSONObject = isPlainObject(raw) ? raw : {}
      return {
        ...field,
        version: session.version.value,
        label:
          field.key === 'value'
            ? panels.value.lowcodeValueBinding
            : panels.value.lowcodeModuleEndValue,
        options: [
          ...(selected === 'invalid'
            ? [{ value: 'invalid', label: panels.value.lowcodeValueBindingInvalid, disabled: true }]
            : []),
          { value: 'uncontrolled', label: panels.value.lowcodeValueBindingUncontrolled },
          ...options
        ],
        selected,
        validation
      }
    })
  })
  function current(key: ModuleValueKey, version: number) {
    const request = session.request(version)
    const node = request && currentModuleEditorOwner(editor, request)
    const row = rows.value.find((field) => field.key === key && field.version === version)
    return node && row ? { node, row } : undefined
  }
  function bind(key: ModuleValueKey, value: string, version: number) {
    const target = current(key, version)
    if (!target) return
    const next = moduleBindingFromSelection(value, target.row.options)
    if (next === null) return
    const bindings = { ...target.node.bindings }
    if (next) bindings[key] = next
    else Reflect.deleteProperty(bindings, key)
    editor.updateNodeWithUndo(target.node.id, { bindings }, panels.value.lowcodeFormBindings)
  }
  function validate(key: ModuleValueKey, value: JSONObject, version: number) {
    const target = current(key, version)
    if (!target) return
    const interactiveProps = { ...target.node.interactiveProps }
    if (Object.keys(value).length) interactiveProps[target.row.validationKey] = value
    else Reflect.deleteProperty(interactiveProps, target.row.validationKey)
    editor.updateNodeWithUndo(
      target.node.id,
      { interactiveProps },
      panels.value.lowcodeFormValidation
    )
  }
  return { owner, rows, panels, bind, validate, version: session.version }
}
