import type { NotesTemplateEditor } from '../notes-template'
import { groupTemplateFormFields, groupTemplateSurfaces } from '../responsive/content'
import { applyTemplateMobileLayout } from '../responsive/layout'

export function adaptNotesPagesToMobile(
  editor: NotesTemplateEditor,
  frameIds: readonly string[]
): void {
  for (const frameId of frameIds) {
    const surfaces = editor.graph
      .getChildren(frameId)
      .filter((node) => node.type === 'FRAME' && !node.childIds.length)
    const groups = groupTemplateSurfaces(
      editor,
      frameId,
      surfaces.map((node) => node.id)
    )
    const hidden = new Set<string>()
    for (const surface of surfaces)
      if (surface.name === 'Notebook illustration') hidden.add(groups.get(surface.id) ?? surface.id)
    groupTemplateFormFields(editor, frameId)
    applyTemplateMobileLayout(editor, frameId, { hidden })
  }
}
