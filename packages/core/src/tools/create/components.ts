import type { FigmaComponentNode } from '#core/figma-api'
import { defineTool, nodeSummary, requireNodes } from '#core/tools/schema'
import { hasComponentInstanceReferencePath } from '#core/tools/structure/hierarchy'

export const createComponent = defineTool({
  name: 'create_component',
  mutates: true,
  description: 'Convert a frame/group into a component.',
  params: {
    id: { type: 'string', description: 'Node ID to convert', required: true }
  },
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    const component = figma.createComponentFromNode(node)
    return nodeSummary(component)
  }
})

export const createInstance = defineTool({
  name: 'create_instance',
  mutates: true,
  description: 'Create an instance of a component.',
  params: {
    component_id: { type: 'string', description: 'Component node ID', required: true },
    parent_id: {
      type: 'string',
      description: 'Parent node for the new instance; defaults to the current page'
    },
    insert_index: {
      type: 'number',
      description: 'Exact sibling index under parent_id; omit to append'
    },
    x: { type: 'number', description: 'X position' },
    y: { type: 'number', description: 'Y position' }
  },
  execute: (figma, args) => {
    const component = figma.getNodeById(args.component_id)
    if (!component) return { error: `Component "${args.component_id}" not found` }
    if (component.type !== 'COMPONENT') {
      return { error: `Node "${args.component_id}" is not a component` }
    }
    const parent = args.parent_id ? figma.getNodeById(args.parent_id) : figma.currentPage
    if (!parent) return { error: `Parent "${args.parent_id}" not found` }
    const rawParent = figma.graph.getNode(parent.id)
    if (!rawParent || !figma.graph.isContainer(parent.id)) {
      return {
        error: `Parent "${parent.id}" (${rawParent?.type ?? 'unknown'}) cannot contain children`
      }
    }
    if (
      args.insert_index !== undefined &&
      (!Number.isInteger(args.insert_index) || args.insert_index < 0)
    ) {
      return { error: 'insert_index must be a non-negative integer' }
    }
    if (hasComponentInstanceReferencePath(figma.graph, component.id, parent.id)) {
      return {
        error: `Cannot create an instance of component "${component.id}" inside "${parent.id}": component/instance reference cycle`
      }
    }
    const rawInstance = figma.graph.createInstance(component.id, parent.id)
    if (!rawInstance) return { error: `Failed to create instance of component "${component.id}"` }
    const instance = figma.getNodeById(rawInstance.id)
    if (!instance) return { error: `Created instance "${rawInstance.id}" could not be resolved` }
    if (args.insert_index !== undefined) {
      figma.graph.reorderChild(instance.id, parent.id, args.insert_index)
    }
    if (args.x !== undefined) instance.x = args.x
    if (args.y !== undefined) instance.y = args.y
    const index = parent.children.findIndex((child) => child.id === instance.id)
    return { ...nodeSummary(instance), parent_id: parent.id, index }
  }
})

export const combineAsVariants = defineTool({
  name: 'combine_as_variants',
  mutates: true,
  description:
    'Combine components sharing a parent into a component set (variant set). Components named ' +
    '"Category/Value" (e.g. "Button/Primary") derive variant properties from the name segments.',
  params: {
    ids: { type: 'string[]', description: 'Component node IDs to combine', required: true }
  },
  execute: (figma, { ids }) => {
    const nodes = requireNodes(figma, ids)
    if (!nodes) return { error: 'One or more node IDs were not found' }
    if (nodes.length < 2) return { error: 'Need at least 2 components to combine as variants' }
    if (!nodes.every((node): node is FigmaComponentNode => node.type === 'COMPONENT')) {
      return { error: 'combineAsVariants requires COMPONENT nodes' }
    }
    const parent = nodes[0].parent ?? figma.currentPage
    if (!nodes.every((node) => node.parent?.id === parent.id)) {
      return { error: 'combineAsVariants requires components to share a parent' }
    }
    try {
      const componentSet = figma.combineAsVariants(nodes, parent)
      return nodeSummary(componentSet)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
})
