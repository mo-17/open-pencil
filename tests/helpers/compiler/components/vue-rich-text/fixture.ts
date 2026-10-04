import { buildOpenPencilVueRichText } from '#compiler/adapters/vue/modules/rich-text'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const caller = `<script setup lang="ts">
import { ref } from 'vue'
import RichText, { type OpenPencilRichTextDocument } from './__openpencil_rich_text.vue'
const doc = (text: string): OpenPencilRichTextDocument => ({ type: 'doc', blocks: [{ type: 'paragraph', align: 'left', children: [{ type: 'text', text, marks: [] }] }] })
const config = ref({ content: doc('Authored body'), textColor: '#111827', linkColor: '#2563EB', fontSize: 16, lineHeight: 1.5 })
const value = ref<unknown>(doc('Seed body'))
const modelValue = ref<unknown>(doc('Model body'))
const changes = ref(0), listener = ref(true), ignore = ref(false), readonly = ref(false), disabled = ref(false), revision = ref(0)
function change(next: OpenPencilRichTextDocument) { changes.value++; if (!ignore.value) value.value = next }
function mutateDocument() {
  if (!value.value || typeof value.value !== 'object' || !('blocks' in value.value)) return
  const block = (value.value as OpenPencilRichTextDocument).blocks[0]
  if (block?.type === 'paragraph' && block.children[0]) block.children[0].text = 'In-place body'
}
</script>
<template><main lang="en">
  <button @click="value = doc('External <script>safe</script>')">External document</button>
  <button @click="value = doc('Seed body')">Seed document</button>
  <button @click="value = { type: 'doc', blocks: [{ type: 'paragraph', align: 'left', children: [{ type: 'text', text: 'Linked body', marks: [{ type: 'link', href: '/safe' }] }] }] }">Link document</button>
  <button @click="config.linkColor = '#DC2626'">Change link color</button>
  <button @click="mutateDocument">Mutate document in place</button>
  <button @click="value = undefined">Missing document</button>
  <button @click="value = { type: 'doc', blocks: [{ type: 'html', value: '<script>unsafe</script>' }] }">Invalid document</button>
  <button @click="value = { type: 'doc', blocks: [{ type: 'paragraph', align: 'left', children: [{ type: 'text', text: 'Unsafe link', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }] }] }">Unsafe document link</button>
  <button @click="value = { type: 'doc', blocks: [] }">Empty document</button>
  <button @click="value = { type: 'doc', blocks: [{ type: 'paragraph', align: 'left', children: [{ type: 'text', text: 'Adjacent ', marks: [] }, { type: 'text', text: 'runs', marks: [] }] }] }">Adjacent document runs</button>
  <button @click="listener = !listener">Toggle listener</button>
  <button @click="ignore = !ignore">Toggle ignored change</button>
  <button @click="readonly = !readonly">Toggle read only</button>
  <button @click="disabled = !disabled">Toggle disabled</button>
  <button @click="revision++">Rerender parent</button>
  <output data-test-id="changes">{{ changes }}</output>
  <form data-test-id="rich-text-form">
    <RichText data-test-id="controlled" :data-parent-revision="revision" :config="config" :value="value" value-bound v-bind="{ 'onUpdate:value': listener ? change : undefined }" :read-only="readonly" :disabled="disabled" name="controlled-document" style="height:260px" />
    <RichText data-test-id="uncontrolled" :data-parent-revision="revision" :config="config" name="local-document" style="height:260px" />
  </form>
  <RichText data-test-id="modelled" :config="config" v-model:value="modelValue" value-bound style="height:260px" />
  <output data-test-id="model-value">{{ JSON.stringify(modelValue) }}</output>
</main></template>
`

/** Direct SFC callers exercise local AST APIs, never design page/document state bindings. */
export function vueRichTextFixture(): Map<string, string> {
  const graph = makeSceneGraph()
  const output = compile({
    graph,
    pageIds: [firstPageId(graph)],
    options: withDefaults({
      target: 'vue',
      router: 'none',
      packageName: 'vue-rich-text-api',
      devMode: false
    })
  })
  if (output.warnings.length) throw new Error(JSON.stringify(output.warnings))
  const files = new Map<string, string>()
  for (const [path, content] of output.files) {
    if (typeof content !== 'string')
      throw new Error('Unexpected binary in the local RichText caller fixture')
    files.set(path, content)
  }
  files.set('src/App.vue', caller)
  files.set('src/__openpencil_rich_text.vue', buildOpenPencilVueRichText())
  return files
}
