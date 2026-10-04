import { buildBasicTemplate } from './basics'
import { getComponentTemplates, isComponentTemplateId } from './catalog'
import { buildCombinationTemplate } from './combinations'
import { createTemplateContext, TEMPLATE_COLORS, templateSurface } from './presentation'
import { resolveComponentTemplatePage } from './target'
import {
  ComponentTemplateError,
  type ComponentTemplateEditor,
  type ComponentTemplatePlacement,
  type ComponentTemplateResult
} from './types'

function instancePrefix(editor: ComponentTemplateEditor): string {
  const names = [...editor.graph.nodes.values()].flatMap((node) => [
    ...(node.state ?? []).flatMap((state) => [state.name, state.id]),
    ...(node.lowcodeDocumentState ?? []).flatMap((state) => [state.name, state.id])
  ])
  let index = 1
  while (names.some((name) => name.startsWith(`template${index}_`))) index++
  return `template${index}`
}

/** Host-owned recipes use existing editor operations so insertion is one undoable transaction. */
export function createComponentTemplate(
  editor: ComponentTemplateEditor,
  id: string,
  locale: string,
  placement: ComponentTemplatePlacement
): ComponentTemplateResult {
  if (!isComponentTemplateId(id)) throw new ComponentTemplateError('unknown-template')
  const page = resolveComponentTemplatePage(editor.graph, placement.parentId, id)
  const parent = editor.graph.getNode(placement.parentId)
  if (!parent) throw new ComponentTemplateError('invalid-target')
  const item = getComponentTemplates(locale).find((entry) => entry.id === id)
  if (!item) throw new ComponentTemplateError('unknown-template')
  const ctx = createTemplateContext(editor, locale, instancePrefix(editor))
  let rootId = ''
  const width = id === 'admin-shell' ? 860 : 360
  editor.undo.runBatch(
    ctx.copy('Insert component template', '插入组件模板') + ': ' + item.name,
    () => {
      // Replay layout after node history: inverse runs last, forward runs first.
      editor.undo.push({
        label: 'Restore template parent layout',
        forward: () => undefined,
        inverse: () => editor.runLayoutForNode(parent.id)
      })
      rootId = ctx.stack(parent.id, item.name, {
        ...templateSurface(TEMPLATE_COLORS.paper, true),
        width,
        height: 200,
        x: placement.x ?? 0,
        y: placement.y ?? 0,
        counterAxisSizing: 'FIXED',
        paddingTop: 20,
        paddingRight: 20,
        paddingBottom: 20,
        paddingLeft: 20,
        itemSpacing: 14,
        cornerRadius: 14,
        responsiveOverrides: {
          compact: {
            minWidth: 0,
            maxWidth: width,
            primaryAxisSizing: 'HUG',
            ...(id === 'admin-shell' ? { counterAxisSizing: 'FILL' as const } : {})
          },
          xl: { primaryAxisSizing: 'HUG' }
        }
      })
      ctx.text(rootId, item.name, { fontSize: 22, lineHeight: 28, fontWeight: 600 })
      ctx.text(rootId, item.description, {
        ...(id === 'cascader' ? { minHeight: 44 } : {}),
        fontSize: 13,
        fills: templateSurface(TEMPLATE_COLORS.muted).fills
      })
      if (!buildBasicTemplate(ctx, rootId, id)) buildCombinationTemplate(ctx, rootId, id)
      const document = editor.graph.getNode(editor.graph.rootId)
      if (!document) throw new ComponentTemplateError('invalid-target')
      if (ctx.states.length)
        editor.updateNodeWithUndo(
          document.id,
          {
            lowcodeDocumentState: [...(document.lowcodeDocumentState ?? []), ...ctx.states]
          },
          ctx.copy('Add template state', '添加模板状态')
        )
      if (ctx.localStates.length)
        editor.updateNodeWithUndo(
          page.id,
          { state: [...(page.state ?? []), ...ctx.localStates] },
          ctx.copy('Add template state', '添加模板状态')
        )
      // Stateless recipes must also finish layout before preview/export, and on redo.
      editor.undo.apply({
        label: 'Lay out component template',
        forward: () => editor.runLayoutForNode(rootId),
        inverse: () => undefined
      })
    }
  )
  return {
    rootId,
    nodeIds: ctx.nodeIds,
    stateNames: [...ctx.states, ...ctx.localStates].map((state) => state.name)
  }
}
