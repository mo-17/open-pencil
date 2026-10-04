import { computed } from 'vue'

import { resolveStepperModule } from '@open-pencil/core/plugins'

import { currentModuleEditorOwner } from '@/app/lowcode/module-editor/owner'

import { useModuleBindingContext } from '../context'
import { moduleBindingFromSelection, moduleBindingSelection } from '../form/fields'
import { writableStateBindingOptions } from '../state-bindings'

export function useStepperBindings() {
  const { editor, panels, owner, source, session } = useModuleBindingContext(
    (node) => node.type === 'FRAME' && !!resolveStepperModule(node.interactiveProps?.module)?.ok
  )
  const rows = computed(() => {
    const node = owner.value
    if (!node) return []
    void source.value
    const options = writableStateBindingOptions(
      editor.graph,
      node,
      editor.state.currentPageId,
      'number',
      panels.value.lowcodeTextSourceBound,
      panels.value.lowcodeTextSourceDocState,
      { rejectInstancePageState: true }
    )
    return [
      {
        version: session.version.value,
        options,
        selected: moduleBindingSelection(node.bindings?.currentIndex, options),
        disabled: node.interactiveProps?.disabled === true,
        readOnly: node.interactiveProps?.readOnly === true
      }
    ]
  })
  function bind(value: string, version: number) {
    const request = session.request(version)
    const node = request && currentModuleEditorOwner(editor, request)
    const current = rows.value.find((row) => row.version === version)
    if (!node || !current || current.version !== version) return
    const next = moduleBindingFromSelection(value, current.options)
    if (next === null) return
    const bindings = { ...node.bindings }
    if (next) bindings.currentIndex = next
    else Reflect.deleteProperty(bindings, 'currentIndex')
    editor.updateNodeWithUndo(node.id, { bindings }, panels.value.lowcodeStepperBindings)
  }
  function control(key: 'disabled' | 'readOnly', value: boolean, version: number) {
    const request = session.request(version)
    const node = request && currentModuleEditorOwner(editor, request)
    if (!node) return
    editor.updateNodeWithUndo(
      node.id,
      {
        interactiveProps: { ...node.interactiveProps, [key]: value }
      },
      panels.value.lowcodeStepperBindings
    )
  }
  return { owner, rows, panels, bind, control }
}
