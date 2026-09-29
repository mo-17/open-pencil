import type { IRModule, IRModuleValueField } from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

import { validationErrorExpression } from './form-validation'
import { setterName } from './react/emit/state'
import { vueValidationErrorExpression } from './vue/lowcode/validation'
import {
  scriptJSON,
  templateExpression,
  type VueEmitContext,
  type VueLocalBinding
} from './vue/shared'

function typeName(field: IRModuleValueField): string {
  return field.type === 'array' ? 'string[]' : field.type
}
function writeReact(field: IRModuleValueField, value: string): string {
  const target = field.write
  if (!target) return ''
  return target.kind === 'docState'
    ? `setDocState(${JSON.stringify(target.name)}, ${value})`
    : `${setterName(target.name)}(${value})`
}
function reactField(field: IRModuleValueField): string {
  if (!field.write) return ''
  const validation = field.validation
  const key = JSON.stringify(validation?.key),
    error = `__fieldErrors[${key}]`
  const reset = `${writeReact(field, field.defaultValue === undefined ? 'undefined' : JSON.stringify(field.defaultValue))};${validation ? `__resetFieldValidation(${key})` : ''}`
  const parts = [`name:${JSON.stringify(field.name)}`, `onReset:()=>{${reset}}`]
  if (validation)
    parts.push(
      `required:${validation.rules.required === true}`,
      `invalid:${error} != null`,
      `error:${error} ?? undefined`,
      `describedBy:${error} ? ${validationErrorExpression(validation.key)} : undefined`,
      `validationKey:${key}`,
      `validationScopeMarker:${field.validationScopeMarker === true}`,
      `onBlur:()=>{void __validateField(${key})}`
    )
  return ` ${field.key === 'value' ? 'field' : 'endField'}={{${parts.join(',')}}}`
}
export function reactModuleValueBindings(module: IRModule | undefined): string {
  return (module?.valueFields ?? [])
    .map((field) => {
      const read = ` ${field.key}Bound ${field.key}={${emitExpression(field.read)}}`
      if (!field.write)
        return read + ` ${field.key === 'value' ? 'field' : 'endField'}={{invalid:true}}`
      const key = JSON.stringify(field.validation?.key)
      const validate = field.validation ? `;void __validateFieldValue(${key},value)` : ''
      const change = ` on${field.key === 'value' ? 'Value' : 'EndValue'}Change={(value:${typeName(field)})=>{${writeReact(field, 'value')}${validate}}}`
      return read + change + reactField(field)
    })
    .join('')
}
function writeVue(field: IRModuleValueField, value: string, context: VueEmitContext): string {
  const target = field.write
  if (!target) return ''
  return target.kind === 'docState'
    ? `__setDocState(${scriptJSON(target.name)},${value})`
    : `${context.writableStateNames.get(target.name)}.value=${value}`
}
function vueField(
  field: IRModuleValueField,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string {
  const reset = `__opModuleReset_${++context.eventIndex}`,
    factory = `__opModuleField_${context.eventIndex}`
  const validation = field.validation,
    key = scriptJSON(validation?.key),
    error = `__fieldErrors.value[${key}]`
  const clear = validation ? `;__fieldErrors.value={...__fieldErrors.value,[${key}]:null}` : ''
  context.eventFunctions.push(
    `function ${reset}():void {${writeVue(field, scriptJSON(field.defaultValue), context)}${clear}}`
  )
  const parts = [`name:${scriptJSON(field.name)}`, `onReset:${reset}`]
  if (validation)
    parts.push(
      `required:${validation.rules.required === true}`,
      `invalid:${error}!=null`,
      `error:${error}??undefined`,
      `describedBy:${error}?description:undefined`,
      `validationKey:${key}`,
      `validationScopeMarker:${field.validationScopeMarker === true}`,
      `onBlur:()=>__validateField(${key})`
    )
  context.eventFunctions.push(
    `function ${factory}(${validation ? 'description:string' : ''}) {return {${parts.join(',')}}}`
  )
  const argument = validation ? vueValidationErrorExpression(validation.key, locals) : ''
  return `:${field.key === 'value' ? 'field' : 'end-field'}="${escapeAttribute(`${factory}(${argument})`)}"`
}
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
export function vueModuleValueBindings(
  module: IRModule | undefined,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string[] {
  return (module?.valueFields ?? []).flatMap((field) => {
    const name = field.key === 'value' ? 'value' : 'end-value'
    const attrs = [
      `:${name}-bound="true"`,
      `:${name}="${escapeAttribute(templateExpression(field.read, context.identAliases, locals))}"`
    ]
    if (!field.write)
      return [...attrs, `:${field.key === 'value' ? 'field' : 'end-field'}="{invalid:true}"`]
    if (field.write.kind === 'state' && !context.writableStateNames.has(field.write.name))
      return attrs
    const handler = `__opModuleValue_${++context.eventIndex}`
    const validate = field.validation
      ? `;__validateFieldValue(${scriptJSON(field.validation.key)},value)`
      : ''
    context.eventFunctions.push(
      `function ${handler}(value:${typeName(field)}):void {${writeVue(field, 'value', context)}${validate}}`
    )
    return [...attrs, `@${name}-change="${handler}"`, vueField(field, context, locals)]
  })
}
