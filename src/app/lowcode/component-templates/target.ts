import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { ComponentTemplateId } from './catalog'
import { ComponentTemplateError } from './types'

const FORM_RECIPES = new Set<ComponentTemplateId>(['validated-form', 'dialog-form', 'tabs-details'])
const PARENTS = new Set(['CANVAS', 'FRAME', 'GROUP', 'SECTION', 'FORM'])
const COMPONENT_SCOPES = new Set(['COMPONENT', 'COMPONENT_SET', 'INSTANCE'])

/** Recipes own page/document state; they cannot silently change scope inside a master or instance. */
export function resolveComponentTemplatePage(
  graph: SceneGraph,
  parentId: string,
  id: ComponentTemplateId
): SceneNode {
  const parent = graph.getNode(parentId)
  if (!parent || !PARENTS.has(parent.type)) throw new ComponentTemplateError('invalid-target')
  let current: SceneNode | undefined = parent
  const seen = new Set<string>()
  while (current) {
    if (
      seen.has(current.id) ||
      current.locked ||
      current.internalOnly ||
      current.librarySource?.readOnly ||
      COMPONENT_SCOPES.has(current.type) ||
      (FORM_RECIPES.has(id) && current.type === 'FORM')
    )
      throw new ComponentTemplateError('invalid-target')
    seen.add(current.id)
    if (current.type === 'CANVAS') return current
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  throw new ComponentTemplateError('invalid-target')
}
