import type { UploadButtonModuleConfig } from '@open-pencil/core/plugins'

/** Runtime-prop harness; does not claim editor FRAME disabled-binding support. */
export function uploadDisabledHost(
  target: 'react' | 'vue',
  config: UploadButtonModuleConfig
): string {
  const source = JSON.stringify(config)
  if (target === 'react') {
    return `import { useState } from 'react'
import OpenPencilUploadButton from './__openpencil_upload_button'
const config = ${source}
export default function App() {
  const [locked, setLocked] = useState(false)
  return <main>
    <OpenPencilUploadButton config={config} disabled={locked} style={{ position: 'absolute', top: 80, left: 24, width: 280, height: 48 }} />
    <div style={{ position: 'absolute', top: 80, left: 600 }}>
      <button type="button" onClick={() => setLocked(true)}>Disable selection</button>
      <button type="button" onClick={() => setLocked(false)}>Enable selection</button>
    </div>
  </main>
}
`
  }
  return `<script setup lang="ts">
import { ref } from 'vue'
import OpenPencilUploadButton from '../__openpencil_upload_button.vue'
const config = ${source}
const locked = ref(false)
</script>
<template>
  <main>
    <OpenPencilUploadButton :config="config" :disabled="locked" style="position:absolute;top:80px;left:24px;width:280px;height:48px" />
    <div style="position:absolute;top:80px;left:600px">
      <button type="button" @click="locked = true">Disable selection</button>
      <button type="button" @click="locked = false">Enable selection</button>
    </div>
  </main>
</template>
`
}
