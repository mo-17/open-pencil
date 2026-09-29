import {
  MOUNTED_VALIDATION_SUMMARY_OBSERVER,
  nodesUseMountedValidationSummary
} from '#compiler/adapters/validation-summary'
import type { IRNode } from '#compiler/ir/types'

import { escapeAttr, escapeStaticText, scriptJSON, type VueEmitContext } from '../shared'

export function buildVueMountedValidationSummary(): string {
  return `
import { defineComponent, h, onBeforeUnmount, onMounted, ref, type PropType } from 'vue'

${MOUNTED_VALIDATION_SUMMARY_OBSERVER}

export const __OpenPencilMountedValidationSummary = defineComponent({
  props: {
    fieldKeys: { type: Array as PropType<readonly string[]>, required: true },
    errors: { type: Object as PropType<Readonly<Record<string, string | null>>>, required: true },
    title: { type: String, required: true }
  },
  setup(props) {
    const anchor = ref<HTMLDivElement | null>(null)
    const mountedKeys = ref<string[]>([])
    let disconnect: (() => void) | undefined
    onMounted(() => {
      if (anchor.value) disconnect = __opObserveMountedValidationKeys(anchor.value, keys => { mountedKeys.value = keys })
    })
    onBeforeUnmount(() => disconnect?.())
    return () => {
      const keys = props.fieldKeys.filter(key => mountedKeys.value.includes(key) && props.errors[key])
      return h('div', { ref: anchor, hidden: keys.length === 0, class: 'openpencil-validation-error', role: 'alert' },
        keys.length > 0 ? [h('p', props.title), h('ul', keys.map(key => h('li', { key }, props.errors[key] ?? '')))] : [])
    }
  }
})
`
}

export function emitVueValidationSummary(
  keys: readonly string[],
  title: string,
  context: VueEmitContext,
  indent: number,
  mountedOnly = false
): string {
  const pad = '  '.repeat(indent)
  const innerPad = '  '.repeat(indent + 1)
  const itemPad = '  '.repeat(indent + 2)
  context.expressionIndex += 1
  const binding = `__opValidationSummaryKeys_${context.expressionIndex}`
  context.templateBindings.push(`const ${binding} = ${scriptJSON(keys)}`)
  if (mountedOnly) {
    return `${pad}<OpenPencilMountedValidationSummary :field-keys="${binding}" :errors="__fieldErrors" title="${escapeAttr(title)}" />\n`
  }
  return [
    `${pad}<div v-if="${binding}.some((id) => __fieldErrors[id])" class="openpencil-validation-error" role="alert">`,
    `${innerPad}<p>${escapeStaticText(title)}</p>`,
    `${innerPad}<ul>`,
    `${itemPad}<li v-for="id in ${binding}.filter((item) => __fieldErrors[item])" :key="id">{{ __fieldErrors[id] }}</li>`,
    `${innerPad}</ul>`,
    `${pad}</div>\n`
  ].join('\n')
}

export function buildVueValidationImport(nodes: readonly IRNode[]): string {
  const names = ['__opValidateValue']
  if (nodesUseMountedValidationSummary(nodes)) {
    names.push('__OpenPencilMountedValidationSummary as OpenPencilMountedValidationSummary')
  }
  return `import { ${names.join(', ')} } from '../lowcode-validation'`
}
