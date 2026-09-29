import type { EventName, SceneNode } from '@open-pencil/scene-graph'

const FIELD_EVENTS: readonly EventName[] = ['onChange', 'onFocus', 'onBlur']
const BUTTON_EVENTS: readonly EventName[] = ['onClick', 'onFocus', 'onBlur']
const FORM_EVENTS: readonly EventName[] = ['onSubmit']
const ACTION_EVENTS: readonly EventName[] = [...FIELD_EVENTS, 'onClick', 'onSubmit']

export function editableNodeEvents(type: SceneNode['type'] | undefined): readonly EventName[] {
  switch (type) {
    case 'BUTTON':
      return BUTTON_EVENTS
    case 'FORM':
      return FORM_EVENTS
    case 'INPUT':
    case 'TEXTAREA':
    case 'SELECT':
    case 'RADIO':
    case 'CHECKBOX':
    case 'SWITCH':
    case 'DATEPICKER':
      return FIELD_EVENTS
    default:
      return []
  }
}

export function eventAtActionPath(path: string | undefined): EventName | undefined {
  return ACTION_EVENTS.find((name) => path?.startsWith(`${name}[`))
}
