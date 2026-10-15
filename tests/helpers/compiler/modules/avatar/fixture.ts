import { toUint8Array } from 'js-base64'

import { compile, withDefaults, type CompilerTarget } from '@open-pencil/compiler'
import { SceneGraph, readModuleInstance, type Fill } from '@open-pencil/scene-graph'

import { createAvatarModuleFrameOverrides } from '#core/plugins/avatar'

// Tiny local PNG fixture; no downloaded media or font dependency.
export const AVATAR_PNG = Uint8Array.from(
  Buffer.from(
    toUint8Array(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8Dwn4GBgYGJAQoAHhgCARZ1mJMAAAAASUVORK5CYII='
    )
  )
)
export function avatarImageFill(imageHash = 'avatar-fixture'): Fill {
  return {
    type: 'IMAGE',
    imageHash,
    imageScaleMode: 'FILL',
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true
  }
}
export function avatarGraph() {
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  graph.images.set('avatar-fixture', AVATAR_PNG)
  graph.images.set('avatar-alternate', AVATAR_PNG)
  // Valid PNG signature with a truncated body exercises actual decode failure, not a fake event.
  graph.images.set('avatar-broken', AVATAR_PNG.slice(0, 16))
  const samples = [
    {
      config: { name: '替换图片' },
      x: 246,
      y: 24,
      width: 64,
      height: 64,
      image: 'avatar-alternate'
    },
    { config: { name: 'Alex Morgan' }, x: 24, y: 24, width: 64, height: 64 },
    {
      config: { name: '张小明', shape: 'rounded', fallbackText: '小明', borderWidth: 2 },
      x: 120,
      y: 24,
      width: 64,
      height: 64
    },
    {
      config: { name: '本地图片', size: 96, shape: 'circle' },
      x: 24,
      y: 120,
      width: 96,
      height: 96,
      image: 'avatar-fixture'
    },
    {
      config: { name: '损坏图片', size: 96 },
      x: 150,
      y: 120,
      width: 96,
      height: 96,
      image: 'avatar-broken'
    },
    {
      config: {
        name: '窄容器',
        fallbackText: '长回退文本',
        size: 256,
        fontSize: 96,
        shape: 'square',
        borderWidth: 8
      },
      x: 24,
      y: 244,
      width: 40,
      height: 24
    },
    {
      config: { name: '适应图片', size: 96, imageFit: 'contain', shape: 'rounded', borderWidth: 2 },
      x: 100,
      y: 244,
      width: 96,
      height: 48,
      image: 'avatar-fixture'
    }
  ]
  for (const sample of samples)
    graph.createNode('FRAME', pageId, {
      ...createAvatarModuleFrameOverrides(sample.config),
      x: sample.x,
      y: sample.y,
      width: sample.width,
      height: sample.height,
      ...(sample.image ? { fills: [avatarImageFill(sample.image)] } : {})
    })
  return { graph, pageId }
}
export function avatarFixture(target: CompilerTarget, updates = false) {
  const { graph, pageId } = avatarGraph()
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (updates && (target === 'react' || target === 'vue')) avatarUpdates(result.files, target)
  return result
}

function avatarUpdates(files: Map<string, string | Uint8Array>, target: 'react' | 'vue'): void {
  const module = readModuleInstance(
    createAvatarModuleFrameOverrides({ name: 'Avatar update' }).interactiveProps?.module
  )
  if (!module) throw new Error('Avatar fixture module invalid')
  const initial = JSON.stringify({
    ...module.config,
    imageAsset: 'src/assets/openpencil-image-avatar-broken.png'
  })
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Avatar,{type OpenPencilAvatarConfig} from './__openpencil_avatar'
export default function App(){const [config,setConfig]=useState<OpenPencilAvatarConfig>(${initial})
return <main><button onClick={()=>setConfig({...config,imageAsset:'src/assets/openpencil-image-avatar-fixture.png'})}>Use local image</button>
<button onClick={()=>setConfig({...config,imageAsset:undefined,name:'张小明'})}>Use initials</button>
<button onClick={()=>setConfig({...config,imageAsset:'src/assets/openpencil-image-avatar-alternate.png'})}>Use alternate image</button>
<button onClick={()=>setConfig({...config,imageAsset:'src/assets/openpencil-image-avatar-broken.png'})}>Use broken image</button>
<button onClick={()=>setConfig({...config,imageAsset:'https://example.com/must-not-load.png'})}>Unknown asset</button>
<Avatar config={config} style={{width:96,height:96}}/></main>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Avatar,{type OpenPencilAvatarConfig} from './__openpencil_avatar.vue'
const config=ref<OpenPencilAvatarConfig>(${initial})
</script><template><main><button @click="config={...config,imageAsset:'src/assets/openpencil-image-avatar-fixture.png'}">Use local image</button>
<button @click="config={...config,imageAsset:undefined,name:'张小明'}">Use initials</button>
<button @click="config={...config,imageAsset:'src/assets/openpencil-image-avatar-alternate.png'}">Use alternate image</button>
<button @click="config={...config,imageAsset:'src/assets/openpencil-image-avatar-broken.png'}">Use broken image</button>
<button @click="config={...config,imageAsset:'https://example.com/must-not-load.png'}">Unknown asset</button>
<Avatar :config="config" style="width:96px;height:96px"/></main></template>`
    )
}
