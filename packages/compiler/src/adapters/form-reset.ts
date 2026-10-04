import type { IRFormResetField } from '#compiler/ir/types'
import { FORM_RESET_FIELD_ATTRIBUTE } from '#compiler/ir/types'

import { lowcodeStateSetterName } from '@open-pencil/lowcode'

export const FORM_RESET_ACCEPTED_EVENT = '__openPencilFormResetAccepted'

interface VueFormResetContext {
  eventIndex: number
  eventFunctions: string[]
  writableStateNames: ReadonlyMap<string, string>
}

function scriptJSON(value: string | number | boolean | readonly string[]): string {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script')
}

function resetPrelude(nativeEvent: string): string[] {
  return [
    'const __opResetForm = event.currentTarget',
    'if (!(__opResetForm instanceof HTMLFormElement) || event.target !== __opResetForm) return',
    `const __opResetEvent = ${nativeEvent}`,
    'const __opResetWindow = __opResetForm.ownerDocument.defaultView',
    'if (!__opResetWindow) return',
    `const __opReadResetNodes = () => Array.from(__opResetForm.querySelectorAll<HTMLElement>('[${FORM_RESET_FIELD_ATTRIBUTE}]')).filter(node => { const owner = node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement ? node.form : node.closest('form'); return owner === __opResetForm })`,
    'const __opResetNodes = __opReadResetNodes()'
  ]
}

function resetValidationPrelude(keys: readonly string[]): string[] {
  if (keys.length === 0) return []
  return [
    `const __opResetValidationKeys = [...new Set<string>(${scriptJSON(keys)})]`,
    "const __opReadValidationNodes = () => Array.from(__opResetForm.querySelectorAll<HTMLElement>('[data-openpencil-validation-field-key]')).filter(node => node.closest('form') === __opResetForm)",
    'const __opValidationNodes = __opReadValidationNodes()'
  ]
}

function sameMountedNodes(keys: readonly string[]): string {
  const checks = [
    'const __opNextResetNodes = __opReadResetNodes()',
    'if (__opNextResetNodes.length !== __opResetNodes.length || __opNextResetNodes.some((node, index) => node !== __opResetNodes[index])) return'
  ]
  if (keys.length > 0)
    checks.push(
      'const __opNextValidationNodes = __opReadValidationNodes()',
      'if (__opNextValidationNodes.length !== __opValidationNodes.length || __opNextValidationNodes.some((node, index) => node !== __opValidationNodes[index])) return'
    )
  return checks.join('; ')
}

function writeFields(
  fields: readonly IRFormResetField[],
  write: (field: IRFormResetField, value: string) => string | undefined
): string[] {
  return fields.flatMap((field) => {
    const value = scriptJSON(field.defaultValue)
    const statement = write(field, value)
    if (!statement) return []
    const key = `${field.write.kind}:${field.write.name}`
    return [`${statement}; __opResetValues[${scriptJSON(key)}] = ${value}`]
  })
}

function resetBody(
  fields: readonly IRFormResetField[],
  keys: readonly string[],
  nativeEvent: string,
  clearValidation: string,
  write: (field: IRFormResetField, value: string) => string | undefined
): string {
  const statements = [
    ...resetPrelude(nativeEvent),
    ...resetValidationPrelude(keys),
    'queueMicrotask(() => {',
    `if (__opResetEvent.defaultPrevented || !__opResetForm.isConnected) return; ${sameMountedNodes(keys)}`,
    '__opResetWindow.setTimeout(() => {',
    `if (__opResetEvent.defaultPrevented || !__opResetForm.isConnected) return; ${sameMountedNodes(keys)}`,
    ...(keys.length > 0 ? [clearValidation] : []),
    'const __opResetValues: Record<string, string | number | boolean | string[]> = {}',
    ...writeFields(fields, write),
    `__opResetForm.dispatchEvent(new __opResetWindow.CustomEvent(${scriptJSON(FORM_RESET_ACCEPTED_EVENT)}, { detail: { values: __opResetValues } }))`,
    '}, 0)',
    '})'
  ]
  return statements.join('; ')
}

export function reactFormResetAttribute(
  fields: readonly IRFormResetField[],
  validationKeys: readonly string[]
): string {
  const body = resetBody(
    fields,
    validationKeys,
    'event.nativeEvent',
    'for (const key of __opResetValidationKeys) __resetFieldValidation(key)',
    (field, value) =>
      field.write.kind === 'docState'
        ? `setDocState(${scriptJSON(field.write.name)}, ${value})`
        : `${lowcodeStateSetterName(field.write.name)}(${value})`
  )
  return `onReset={(event) => { ${body} }}`
}

export function vueFormResetAttribute(
  fields: readonly IRFormResetField[],
  validationKeys: readonly string[],
  context: VueFormResetContext
): string {
  const name = `__opFormReset_${++context.eventIndex}`
  const body = resetBody(
    fields,
    validationKeys,
    'event',
    'for (const key of __opResetValidationKeys) __resetFieldValidation(key)',
    (field, value) => {
      if (field.write.kind === 'docState')
        return `__setDocState(${scriptJSON(field.write.name)}, ${value})`
      const state = context.writableStateNames.get(field.write.name)
      return state ? `${state}.value = ${value}` : undefined
    }
  )
  context.eventFunctions.push(`function ${name}(event: Event): void { ${body} }`)
  return `@reset="${name}($event)"`
}
