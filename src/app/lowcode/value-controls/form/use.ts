import { isPlainObject } from 'es-toolkit/predicate'
import { computed } from 'vue'

import {
  moduleValueFields,
  resolveModuleFieldName,
  validModuleFieldName
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { currentModuleEditorOwner } from '@/app/lowcode/module-editor/owner'

import { useModuleBindingContext } from '../context'
import {
  moduleBindingFromSelection,
  moduleBindingOptions,
  moduleBindingSelection,
  moduleValueReadOnly,
  type ModuleValueKey
} from './fields'

export function useModuleValueBindings() {
  const { editor, panels, owner, source, session } = useModuleBindingContext(
    (node) => moduleValueFields(node).length > 0
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
      const binding = node.bindings?.[field.key]
      let defaultFieldName: string = field.key
      if (binding?.kind === 'docState') defaultFieldName = binding.docStateName ?? field.key
      else if (binding?.kind === 'ref')
        defaultFieldName =
          editor.graph
            .getNode(editor.state.currentPageId)
            ?.state?.find((state) => state.id === binding.stateId)?.name ?? field.key
      const nameMap = node.interactiveProps?.moduleFieldNames
      const configuredName = isPlainObject(nameMap) ? nameMap[field.key] : undefined
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
        validation,
        fieldName: typeof configuredName === 'string' ? configuredName : '',
        defaultFieldName,
        fieldNameInvalid: resolveModuleFieldName(node, field.key, defaultFieldName) === undefined
      }
    })
  })
  const readOnly = computed(() => {
    void source.value
    return owner.value ? moduleValueReadOnly(owner.value) : undefined
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
  function controlReadOnly(value: boolean, version: number) {
    const request = session.request(version)
    const node = request && currentModuleEditorOwner(editor, request)
    if (
      !node ||
      !rows.value.some((field) => field.version === version) ||
      moduleValueReadOnly(node) === undefined ||
      moduleValueReadOnly(node) === value
    )
      return
    editor.updateNodeWithUndo(
      node.id,
      { interactiveProps: { ...node.interactiveProps, readOnly: value } },
      panels.value.lowcodeControlReadOnly
    )
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
  function fieldName(key: ModuleValueKey, value: string, version: number) {
    const target = current(key, version)
    if (!target || (value !== '' && !validModuleFieldName(value))) return
    const raw = target.node.interactiveProps?.moduleFieldNames
    const previous = isPlainObject(raw) ? raw : {}
    const moduleFieldNames: Record<string, string> = {}
    for (const name of ['value', 'endValue'] as const) {
      const existing = previous[name]
      if (typeof existing === 'string' && validModuleFieldName(existing))
        moduleFieldNames[name] = existing
    }
    if (value) moduleFieldNames[key] = value
    else Reflect.deleteProperty(moduleFieldNames, key)
    const interactiveProps = { ...target.node.interactiveProps }
    if (Object.keys(moduleFieldNames).length) interactiveProps.moduleFieldNames = moduleFieldNames
    else Reflect.deleteProperty(interactiveProps, 'moduleFieldNames')
    editor.updateNodeWithUndo(
      target.node.id,
      { interactiveProps },
      panels.value.lowcodeBackendFieldName
    )
  }
  function fieldNameError(value: string): string | undefined {
    return value === '' || validModuleFieldName(value)
      ? undefined
      : panels.value.lowcodeWorkflowParamInvalidIdentifier
  }
  return {
    owner,
    rows,
    panels,
    bind,
    readOnly,
    controlReadOnly,
    validate,
    fieldName,
    fieldNameError,
    version: session.version
  }
}
