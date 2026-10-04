import { computed } from 'vue'

import { moduleDataField } from '@open-pencil/core/plugins'

import { currentModuleEditorOwner } from '@/app/lowcode/module-editor/owner'

import { useModuleBindingContext } from '../context'
import { moduleBindingFromSelection, moduleBindingSelection } from '../form/fields'
import { readableStateBindingOptions } from '../state-bindings'

export function useModuleDataBinding() {
  const { editor, panels, owner, source, session } = useModuleBindingContext(
    (node) => !!moduleDataField(node)
  )
  const rows = computed(() => {
    const node = owner.value
    const field = node && moduleDataField(node)
    if (!node || !field) return []
    void source.value
    const options = readableStateBindingOptions(
      editor.graph,
      node,
      editor.state.currentPageId,
      field.type,
      panels.value.lowcodeTextSourceBound,
      panels.value.lowcodeTextSourceDocState
    )
    const selected = moduleBindingSelection(node.bindings?.[field.key], options)
    return [{ key: field.key, options, selected, version: session.version.value }]
  })
  function bind(value: string, version: number) {
    const request = session.request(version)
    const node = request && currentModuleEditorOwner(editor, request)
    const row = rows.value.find((candidate) => candidate.version === version)
    if (!node || !row) return
    const next = moduleBindingFromSelection(value, row.options)
    if (next === null) return
    const bindings = { ...node.bindings }
    if (next) bindings[row.key] = next
    else Reflect.deleteProperty(bindings, row.key)
    editor.updateNodeWithUndo(node.id, { bindings }, panels.value.lowcodeTextSourceBound)
  }
  return { owner, rows, panels, bind }
}
