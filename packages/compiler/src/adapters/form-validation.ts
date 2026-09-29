import type { IRNode } from '#compiler/ir/types'
import { moduleContentNodes } from '#compiler/modules/content-slots'

export const MOUNTED_VALIDATION_KEY_ATTRIBUTE = 'data-openpencil-validation-key'

/** Generated in each validated scope so React and Vue use the same DOM boundary. */
export const VALIDATION_FOCUS_RUNTIME = `function __opValidationFocus(form: EventTarget | null | undefined) {
  if (!form || typeof HTMLFormElement === 'undefined' || !(form instanceof HTMLFormElement)) return (_errors: Readonly<Record<string, string | null>>) => {}
  const read = () => Array.from(form.querySelectorAll<HTMLElement>('[data-openpencil-validation-field-key]')).filter(field => field.closest('form') === form)
  const fields = read()
  return (errors: Readonly<Record<string, string | null>>) => {
    queueMicrotask(() => {
      const current = read()
      if (!form.isConnected || current.length !== fields.length || current.some((field, index) => field !== fields[index])) return
      for (const field of fields) {
        const key = field.getAttribute('data-openpencil-validation-field-key')
        if (!key || !errors[key] || field.closest('[inert],[hidden]') || field.matches('[aria-disabled="true"]')) continue
        const candidates = [field, ...field.querySelectorAll<HTMLElement>('input,textarea,select,button,[tabindex]')]
        for (const target of candidates) {
          if (target.matches(':disabled,[readonly],[aria-disabled="true"],[aria-hidden="true"]') || target.getClientRects().length === 0 || !(target.matches('input,textarea,select,button') || target.tabIndex >= 0)) continue
          target.focus()
          if (target.matches(':focus')) return
        }
      }
    })
  }
}`

export function validationErrorId(key: string): string {
  let hash = 2166136261
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `openpencil-validation-error-${(hash >>> 0).toString(36)}`
}

/** Scope by component instance and nested iteration, independently of the shared validation key. */
export function validationErrorExpression(
  key: string,
  iteration = '__opValidationIteration'
): string {
  return `__opValidationInstance + '-${validationErrorId(key)}-' + ${iteration}.join('-')`
}

export function nodeHasFieldValidation(node: IRNode): boolean {
  if (node.kind === 'conditional') return nodeHasFieldValidation(node.consequent)
  if (node.kind === 'list') return nodeHasFieldValidation(node.template)
  if (node.kind !== 'element') return false
  return (
    node.validation !== undefined ||
    (node.module?.valueFields?.some((field) => field.validation !== undefined) ?? false) ||
    node.children.some(nodeHasFieldValidation) ||
    (moduleContentNodes(node)?.some((slot) => slot.nodes.some(nodeHasFieldValidation)) ?? false)
  )
}

/** Capture before request gates/async validation. Keys are compared as strings,
 * never interpolated into selectors; nested forms and teleported fields belong
 * to their own actual DOM form. The caller supplies already-escaped key literals. */
export function emitMountedValidationCapture(event: string, keyArray: string): string[] {
  return [
    `const __opValidationForm = ${event}.currentTarget`,
    `if (!(__opValidationForm instanceof HTMLFormElement) || ${event}.target !== __opValidationForm) return`,
    `const __opReadValidationFields = () => Array.from(__opValidationForm.querySelectorAll('[${MOUNTED_VALIDATION_KEY_ATTRIBUTE}]')).filter(field => field.closest('form') === __opValidationForm)`,
    `const __opValidationFields = __opReadValidationFields()`,
    `const __opReadValidationKeys = () => { const mounted = new Set(__opReadValidationFields().map(field => field.getAttribute('${MOUNTED_VALIDATION_KEY_ATTRIBUTE}'))); return ${keyArray}.filter(key => mounted.has(key)); }`,
    `const __opValidationKeys = __opReadValidationKeys()`
  ]
}

/** An async result cannot submit a different panel or a removed form. */
export const MOUNTED_VALIDATION_COMPLETION_GUARD =
  `const __opNextValidationKeys = __opReadValidationKeys(); ` +
  `const __opNextValidationFields = __opReadValidationFields(); ` +
  `if (!__opValidationForm.isConnected || __opNextValidationKeys.length !== __opValidationKeys.length || __opNextValidationKeys.some((key, index) => key !== __opValidationKeys[index]) || __opNextValidationFields.length !== __opValidationFields.length || __opNextValidationFields.some((field, index) => field !== __opValidationFields[index])) return;`
