import type { DesignDocument, DesignElement, DesignNode, DesignStyleDeclaration } from './types'

export interface StaticDocumentBounds {
  minX: number
  minY: number
  width: number
  height: number
}

function cloneNode(node: DesignNode): DesignNode {
  if (node.type === 'text') return { ...node }
  return {
    ...node,
    attrs: { ...node.attrs },
    inlineStyle: node.inlineStyle ? { ...node.inlineStyle } : undefined,
    children: node.children.map(cloneNode)
  }
}

function staticStyleForNode(
  node: DesignElement,
  parent: DesignElement | undefined,
  origin: StaticDocumentBounds
): DesignStyleDeclaration {
  const style = { ...node.inlineStyle }
  const source = node.sourceSceneNode
  if (!source) return style
  style.position = 'absolute'
  style.left = `${source.x - (parent ? 0 : origin.minX)}px`
  style.top = `${source.y - (parent ? 0 : origin.minY)}px`
  return style
}

function normalizeNode(
  node: DesignNode,
  origin: StaticDocumentBounds,
  parent?: DesignElement
): DesignNode {
  if (node.type === 'text') return cloneNode(node)
  const normalized: DesignElement = {
    ...node,
    attrs: { ...node.attrs },
    inlineStyle: staticStyleForNode(node, parent, origin),
    children: []
  }
  normalized.children = node.children.map((child) => normalizeNode(child, origin, node))
  return normalized
}

function nodeBounds(node: DesignNode): StaticDocumentBounds | undefined {
  if (node.type === 'text' || !node.sourceSceneNode) return undefined
  return {
    minX: node.sourceSceneNode.x,
    minY: node.sourceSceneNode.y,
    width: node.sourceSceneNode.width,
    height: node.sourceSceneNode.height
  }
}

export function staticDocumentBounds(document: DesignDocument): StaticDocumentBounds {
  const bounds = document.children
    .map(nodeBounds)
    .filter((value): value is StaticDocumentBounds => value !== undefined)
  const minX = bounds.length > 0 ? Math.min(...bounds.map((bound) => bound.minX)) : 0
  const minY = bounds.length > 0 ? Math.min(...bounds.map((bound) => bound.minY)) : 0
  const maxX = bounds.length > 0 ? Math.max(...bounds.map((bound) => bound.minX + bound.width)) : 1
  const maxY = bounds.length > 0 ? Math.max(...bounds.map((bound) => bound.minY + bound.height)) : 1
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

export function normalizeStaticDocument(
  document: DesignDocument,
  bounds: StaticDocumentBounds
): DesignDocument {
  return {
    ...document,
    children: document.children.map((node) => normalizeNode(node, bounds))
  }
}
