import { buildOpenPencilRichTextComponent } from '#compiler/adapters/react/modules/rich-text'
import { buildOpenPencilUploadButtonComponent } from '#compiler/adapters/react/modules/upload-button'
import { buildOpenPencilVueUploadButton } from '#compiler/adapters/vue/modules/upload-button'

import { compile, withDefaults } from '@open-pencil/compiler'
import { UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const config = {
  ...UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
  accept: ['.txt'],
  multiple: true,
  maxFiles: 2,
  maxFileBytes: 8,
  helperText: ''
}

const reactUpload = `import { useState } from 'react'
import Upload from './__openpencil_upload_button'
const config = ${JSON.stringify(config)}
const makeFile = (name: string) => new File(['abc'], name, { type: 'text/plain' })
export default function App() {
  const [files, setFiles] = useState<unknown>(() => [makeFile('seed.txt')])
  const [changes, setChanges] = useState(0)
  const [readonly, setReadonly] = useState(false)
  const [ignore, setIgnore] = useState(false)
  const [actualFiles, setActualFiles] = useState(true)
  const onFilesChange = readonly ? undefined : (next: readonly File[]) => {
    setChanges(value => value + 1)
    setActualFiles(next.every(file => file instanceof File))
    if (!ignore) setFiles(next)
  }
  return <main>
    <button onClick={() => setFiles([makeFile('external.txt')])}>External files</button>
    <button onClick={() => setFiles(undefined)}>Missing files</button>
    <button onClick={() => setFiles([{ name: 'fake.txt', size: 1 }])}>Invalid metadata</button>
    <button onClick={() => setReadonly(value => !value)}>Toggle read only</button>
    <button onClick={() => setIgnore(value => !value)}>Toggle ignored change</button>
    <output data-test-id="changes">{changes}</output>
    <output data-test-id="actual-files">{String(actualFiles)}</output>
    <form data-test-id="local-form">
      <Upload data-test-id="controlled" config={config} files={files} filesBound onFilesChange={onFilesChange} style={{ marginTop: 24, width: 240, height: 48 }} />
      <div style={{ marginTop: 240 }}><Upload data-test-id="uncontrolled" config={config} style={{ width: 240, height: 48 }} /></div>
    </form>
  </main>
}
`
const vueUpload = `<script setup lang="ts">
import { ref } from 'vue'
import Upload from './__openpencil_upload_button.vue'
const config = ${JSON.stringify(config)}
const makeFile = (name: string) => new File(['abc'], name, { type: 'text/plain' })
const files = ref<unknown>([makeFile('seed.txt')])
const changes = ref(0)
const readonly = ref(false)
const ignore = ref(false)
const actualFiles = ref(true)
function onFilesChange(next: readonly File[]) {
  changes.value++
  actualFiles.value = next.every(file => file instanceof File)
  if (!ignore.value) files.value = next
}
</script>
<template><main>
  <button @click="files = [makeFile('external.txt')]">External files</button>
  <button @click="files = undefined">Missing files</button>
  <button @click="files = [{ name: 'fake.txt', size: 1 }]">Invalid metadata</button>
  <button @click="readonly = !readonly">Toggle read only</button>
  <button @click="ignore = !ignore">Toggle ignored change</button>
  <output data-test-id="changes">{{ changes }}</output>
  <output data-test-id="actual-files">{{ String(actualFiles) }}</output>
  <form data-test-id="local-form">
    <Upload data-test-id="controlled" :config="config" :files="files" files-bound v-bind="{ 'onUpdate:files': readonly ? undefined : onFilesChange }" style="margin-top:24px;width:240px;height:48px" />
    <div style="margin-top:240px"><Upload data-test-id="uncontrolled" :config="config" style="width:240px;height:48px" /></div>
  </form>
</main></template>
`

const richText = `import { useState } from 'react'
import RichText from './__openpencil_rich_text'
const doc = (text: string) => ({ type: 'doc' as const, blocks: [{ type: 'paragraph' as const, align: 'left' as const, children: [{ type: 'text' as const, text, marks: [] }] }] })
const config = { content: doc('Authored body'), textColor: '#111827', linkColor: '#2563EB', fontSize: 16, lineHeight: 1.5 }
export default function App() {
  const [value, setValue] = useState<unknown>(() => doc('Seed body'))
  const [changes, setChanges] = useState(0)
  const [readonly, setReadonly] = useState(false)
  const [ignore, setIgnore] = useState(false)
  const [, rerender] = useState(0)
  return <main>
    <button onClick={() => setValue(doc('External <script>safe</script>'))}>External document</button>
    <button onClick={() => setValue(undefined)}>Missing document</button>
    <button onClick={() => setValue({ type: 'doc', blocks: [{ type: 'html', value: '<script>unsafe</script>' }] })}>Invalid document</button>
    <button onClick={() => setValue({ type: 'doc', blocks: [{ type: 'paragraph', align: 'left', children: [{ type: 'text', text: 'Unsafe link', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }] }] })}>Unsafe document link</button>
    <button onClick={() => setReadonly(value => !value)}>Toggle read only</button>
    <button onClick={() => setIgnore(value => !value)}>Toggle ignored change</button>
    <button onClick={() => rerender(value => value + 1)}>Rerender parent</button>
    <output data-test-id="changes">{changes}</output>
    <form data-test-id="local-form">
      <RichText data-test-id="controlled" config={config} value={value} valueBound onDocumentChange={readonly ? undefined : next => { setChanges(value => value + 1); if (!ignore) setValue(next) }} name="controlled-document" style={{ height: 240 }} />
      <RichText data-test-id="uncontrolled" config={config} name="local-document" style={{ height: 240 }} />
    </form>
  </main>
}
`

/** Explicit component callers exercise API control; these files declare no business state. */
export function controlledLocalDataFixture(
  target: 'react' | 'vue',
  module: 'upload' | 'rich-text'
) {
  const graph = makeSceneGraph()
  const out = compile({
    graph,
    pageIds: [firstPageId(graph)],
    options: withDefaults({
      target,
      router: 'none',
      packageName: 'controlled-local-api',
      devMode: false
    })
  })
  if (out.warnings.length) throw new Error(JSON.stringify(out.warnings))
  const files = new Map(out.files)
  if (target === 'react') {
    files.set('src/App.tsx', module === 'upload' ? reactUpload : richText)
    files.set(
      module === 'upload' ? 'src/__openpencil_upload_button.tsx' : 'src/__openpencil_rich_text.tsx',
      module === 'upload'
        ? buildOpenPencilUploadButtonComponent()
        : buildOpenPencilRichTextComponent()
    )
  } else {
    if (module !== 'upload') throw new Error('Vue rich text remains unsupported')
    files.set('src/App.vue', vueUpload)
    files.set('src/__openpencil_upload_button.vue', buildOpenPencilVueUploadButton())
  }
  return files
}
