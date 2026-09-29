import { isLowcodeNumberValue } from '@open-pencil/lowcode'

type InputProperties = Record<string, unknown>

/** Change only authored properties; bound state is owned by its declaration. */
export function changeInputType(properties: InputProperties, inputType: string): InputProperties {
  const previous = properties.inputType ?? 'text'
  const next = { ...properties }
  if (inputType) next.inputType = inputType
  else Reflect.deleteProperty(next, 'inputType')
  const type = inputType || 'text'
  if (type !== previous) {
    for (const key of ['min', 'max', 'step']) Reflect.deleteProperty(next, key)
    if (type === 'time' || type === 'datetime-local' || type === 'color') {
      for (const key of ['value', 'inputMode', 'minLength', 'maxLength', 'placeholder'])
        Reflect.deleteProperty(next, key)
    }
    if (type === 'number' && !isLowcodeNumberValue(next.value))
      Reflect.deleteProperty(next, 'value')
  }
  if (type !== 'text' && type !== 'search') Reflect.deleteProperty(next, 'suggestions')
  if (type !== 'number') {
    Reflect.deleteProperty(next, 'showStepper')
    Reflect.deleteProperty(next, 'stepperPlacement')
  }
  if (type !== 'password') Reflect.deleteProperty(next, 'showPasswordToggle')
  return next
}
