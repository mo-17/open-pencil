import type { ActionDef, StateDef } from '@open-pencil/scene-graph'

import { templateToast } from '../feedback/actions'

/** Keep edits in page state while one write is pending; failures only unlock the form. */
export function createNotesFeedback(errorTarget: string) {
  const busy: StateDef = {
    id: crypto.randomUUID(),
    name: 'notesBusy',
    type: 'boolean',
    defaultValue: false
  }
  const activity: StateDef = {
    id: crypto.randomUUID(),
    name: 'notesActivity',
    type: 'string',
    defaultValue: ''
  }
  const generation: StateDef = {
    id: crypto.randomUUID(),
    name: 'notesOperationGeneration',
    type: 'string',
    defaultValue: ''
  }
  const pending = `(${busy.name} && ${generation.name} === ("" + $currentUser.generation))`
  const set = (target: StateDef, valueExpr: string): ActionDef => ({
    id: crypto.randomUUID(),
    kind: 'setState',
    targetStateId: target.id,
    valueExpr
  })
  const unlock = () => set(busy, '!1')
  const start = (message: string): ActionDef[] => [
    set(generation, '"" + $currentUser.generation'),
    set(activity, JSON.stringify(message)),
    set(busy, '!0'),
    { id: crypto.randomUUID(), kind: 'setVariable', targetName: errorTarget, valueExpr: '""' }
  ]
  const guard = (consequent: ActionDef[]): ActionDef => ({
    id: crypto.randomUUID(),
    kind: 'condition',
    condExpr: `!${pending}`,
    consequent
  })
  const success = (message: string): ActionDef[] => [unlock(), templateToast(message)]
  const remove = (resourceId: string, idExpr: string, completed: ActionDef[]): ActionDef =>
    guard([
      ...start('Deleting note…'),
      {
        id: crypto.randomUUID(),
        kind: 'confirm',
        messageExpr: JSON.stringify('Delete this note? This cannot be undone.'),
        confirmLabel: 'Delete note',
        cancelLabel: 'Keep note',
        consequent: [
          {
            id: crypto.randomUUID(),
            kind: 'backendRequest',
            resourceId,
            operation: 'delete',
            idExpr,
            errorTarget,
            onSuccess: [...completed, ...success('Note deleted.')],
            onError: [unlock()]
          }
        ],
        alternate: [unlock()]
      }
    ])
  return {
    states: [busy, activity, generation],
    pending,
    activity,
    guard,
    start,
    unlock,
    success,
    remove
  }
}
