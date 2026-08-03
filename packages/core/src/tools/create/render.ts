import {
  applyRenderPlacement,
  renderPlacementSiblings,
  resolveRenderPlacement
} from '#core/design-jsx/render-placement'
import { defineTool } from '#core/tools/schema'

export const render = defineTool({
  name: 'render',
  mutates: true,
  description:
    'Render JSX to design nodes, including real lowcode BUTTON/INPUT/SELECT/CHECKBOX/FORM/LIST/RADIO/TEXTAREA/DATEPICKER/SWITCH nodes through the matching PascalCase tags. Never use a Frame as a functional-control substitute. Lowcode tags accept direct control props plus a validated interactiveProps object; BUTTON/INPUT/TEXTAREA accept textColor and INPUT/TEXTAREA also accept placeholderColor as #RRGGBB values. Supports inline SVG paths, including open stroked paths: <svg viewBox="0 0 24 24" size={24}><path d="M2 12 L22 12" stroke="#000" fill="none" /></svg>. Use update_lowcode_node after render for bindings/events. Use replace_id to swap one skeleton placeholder for the complete rendered result; a JSX fragment replaces it with every root inserted consecutively at the old sibling index, and replace_id takes precedence over parent_id/insert_index. Example: <Form flex="col" gap={12}><Input placeholder="Email" textColor="#111827" placeholderColor="#6B7280" /><Button textColor="#F9FAFB">Submit</Button></Form>',
  params: {
    replace_id: {
      type: 'string',
      description: 'Node ID to replace — new node takes its position in parent, old node is deleted'
    },
    parent_id: { type: 'string', description: 'Parent node ID to render into' },
    insert_index: {
      type: 'number',
      description: 'Position among siblings (0 = first child). Omit to append at end.'
    },
    x: { type: 'number', description: 'X position of the root node' },
    y: { type: 'number', description: 'Y position of the root node' },
    jsx: {
      type: 'string',
      description:
        'JSX string to render. Functional controls must use Button/Input/Select/Checkbox/Form/List/Radio/Textarea/DatePicker/Switch, not Frame substitutes.',
      required: true
    }
  },
  execute: async (figma, args, context) => {
    const { renderJSX } = await import('#core/design-jsx/render.js')

    const placement = resolveRenderPlacement(figma.graph, {
      defaultParentId: figma.currentPageId,
      parentId: args.parent_id,
      replaceId: args.replace_id,
      insertIndex: args.insert_index
    })

    const results = await renderJSX(figma.graph, args.jsx, {
      parentId: placement.parentId,
      x: args.x,
      y: args.y,
      signal: context?.signal,
      layout: context?.deferLayout !== true
    })
    const result = results[0]
    const rootIds = results.map((node) => node.id)
    let appliedPlacement: ReturnType<typeof applyRenderPlacement>
    try {
      appliedPlacement = applyRenderPlacement(figma.graph, rootIds, placement)
    } catch (error) {
      for (const id of rootIds.toReversed()) figma.graph.deleteNode(id)
      throw error
    }

    const siblings = renderPlacementSiblings(results, appliedPlacement)
    return {
      id: result.id,
      name: result.name,
      type: result.type,
      children: result.childIds,
      parent_id: appliedPlacement.parentId,
      index: appliedPlacement.index,
      ...(appliedPlacement.replacedId ? { replaced_id: appliedPlacement.replacedId } : {}),
      ...(result.warnings ? { warnings: result.warnings } : {}),
      ...(siblings.length > 0 ? { siblings } : {})
    }
  }
})
