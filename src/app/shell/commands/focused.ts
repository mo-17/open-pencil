import { isCanvasTextInput } from '@open-pencil/vue'
import type { EditorCommandId } from '@open-pencil/vue'

import type { EditorStore } from '@/app/editor/active-store'
import { isInputElement } from '@/app/shell/keyboard/focus'

export const FOCUSED_TEXT_EDIT_EVENT = 'openpencil:text-edit'

/**
 * Commands a focused text field carries out itself. As in VS Code's
 * `EditorOrNativeTextInputCommand`, `execCommand` is the one API that reaches a field's own
 * selection and undo history.
 */
const TEXT_FIELD_EDITS: Partial<Record<EditorCommandId, 'selectAll' | 'undo' | 'redo'>> = {
  'selection.selectAll': 'selectAll',
  'edit.undo': 'undo',
  'edit.redo': 'redo'
}

function focusedElement(): Element | null {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

/** Preview frames own their focus, including when their origin is isolated from the editor. */
export function textFieldFocused(): boolean {
  const active = focusedElement()
  return (
    active instanceof HTMLIFrameElement || (isInputElement(active) && !isCanvasTextInput(active))
  )
}

/**
 * Runs a command against what has keyboard focus when it runs. A focused text field takes the
 * edits it has its own version of, and commands on the document or selection wait for the
 * canvas, as keyboard shortcuts do; view commands still run.
 *
 * Entry points that keep the person's focus, the native menu, run commands through this. The
 * command palette and the in-app menu take focus themselves and act on the document.
 */
export function runFocusedCommand(
  store: EditorStore,
  runCommand: (id: EditorCommandId) => void,
  id: EditorCommandId
): void {
  const active = focusedElement()
  if (id === 'selection.selectAll' && isCanvasTextInput(active)) {
    store.textEditor?.selectAll()
    store.requestRender()
    return
  }
  if (textFieldFocused()) {
    const edit = TEXT_FIELD_EDITS[id]
    if (edit && active instanceof HTMLIFrameElement) {
      active.dispatchEvent(new CustomEvent(FOCUSED_TEXT_EDIT_EVENT, { detail: edit }))
    } else if (edit) {
      document.execCommand(edit)
    } else if (id.startsWith('view.')) runCommand(id)
    return
  }
  runCommand(id)
}

/** An action on the canvas selection that waits, like the commands above, while a field has focus. */
export function onCanvasSelection(action: () => void): () => void {
  return () => {
    if (!textFieldFocused()) action()
  }
}
