import * as v from 'valibot'

import {
  applyRenderPlacement,
  renderPlacementSiblings,
  resolveRenderPlacement
} from '#core/design-jsx/placement'
import { computeAllLayoutsAsync } from '#core/layout'
import { toolNumber } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'

export const render = defineTool({
  name: 'render',

  description:
    'Render JSX to design nodes, including real lowcode BUTTON/INPUT/SELECT/CHECKBOX/FORM/LIST/RADIO/TEXTAREA/DATEPICKER/SWITCH nodes through the matching PascalCase tags. Never use a Frame as a functional-control substitute. Lowcode tags accept direct control props plus a validated interactiveProps object; BUTTON/INPUT/TEXTAREA accept textColor and INPUT/TEXTAREA also accept placeholderColor as #RRGGBB values. Supports inline SVG paths, including open stroked paths: <svg viewBox="0 0 24 24" size={24}><path d="M2 12 L22 12" stroke="#000" fill="none" /></svg>. Use update_lowcode_node after render for bindings/events. Use replace_id to swap one skeleton placeholder for the complete rendered result; a JSX fragment replaces it with every root inserted consecutively at the old sibling index, and replace_id takes precedence over parent_id/insert_index. Example: <Form flex="col" gap={12}><Input placeholder="Email" textColor="#111827" placeholderColor="#6B7280" /><Button textColor="#F9FAFB">Submit</Button></Form>',
  execution: { kind: 'async', mutation: 'document' },
  input: v.strictObject({
    replace_id: v.optional(
      v.pipe(
        v.string(),
        v.description(
          'Node ID to replace — new node takes its position in parent, old node is deleted'
        )
      )
    ),
    parent_id: v.optional(v.pipe(v.string(), v.description('Parent node ID to render into'))),
    insert_index: v.optional(
      toolNumber(
        v.pipe(
          v.number(),
          v.description('Position among siblings (0 = first child). Omit to append at end.')
        )
      )
    ),
    x: v.optional(toolNumber(v.pipe(v.number(), v.description('X position of the root node')))),
    y: v.optional(toolNumber(v.pipe(v.number(), v.description('Y position of the root node')))),
    jsx: v.pipe(v.string(), v.description('JSX string to render'))
  }),
  execute: async (figma, args, context) => {
    const { designJSXRenderer } = await import('#core/design-jsx')
    const { renderJSX } = designJSXRenderer(figma.icons)

    const placement = resolveRenderPlacement(figma.graph, args, figma.currentPageId)

    const results = await renderJSX(figma.graph, args.jsx, {
      parentId: placement.parentId,
      x: placement.x,
      y: placement.y,
      signal: context?.signal,
      layout: false
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

    if (context?.deferLayout !== true) {
      await computeAllLayoutsAsync(figma.graph, placement.pageId, context?.signal)
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
