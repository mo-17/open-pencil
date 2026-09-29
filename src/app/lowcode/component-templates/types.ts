import type { Editor } from '@open-pencil/core/editor'

export type ComponentTemplateEditor = Pick<
  Editor,
  'graph' | 'createShape' | 'updateNodeWithUndo' | 'runLayoutForNode' | 'undo'
>
export interface ComponentTemplatePlacement {
  readonly parentId: string
  readonly x?: number
  readonly y?: number
}
export interface ComponentTemplateResult {
  readonly rootId: string
  readonly nodeIds: readonly string[]
  readonly stateNames: readonly string[]
}
export class ComponentTemplateError extends Error {
  constructor(readonly code: 'unknown-template' | 'unavailable-module' | 'invalid-target') {
    super(code)
    this.name = 'ComponentTemplateError'
  }
}
