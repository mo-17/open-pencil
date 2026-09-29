import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createCarouselModuleFrameOverrides,
  createCarouselModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function carouselRuntimeFixture(target: 'react' | 'vue', devMode = true) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const config = createCarouselModuleInstance({
    label: 'Featured work',
    slides: [
      {
        title: 'First slide',
        description: 'First description',
        imageUrl: 'https://media.example.com/first.png',
        alt: 'First preview',
        href: '#first'
      },
      {
        title: 'Second slide',
        description:
          '<script>plain text</script>\n' + 'Additional detail for this slide.\n'.repeat(20),
        imageUrl: 'https://media.example.com/second.png',
        alt: 'Second preview',
        href: '#second'
      },
      {
        title: 'Third slide: a deliberately long text-only heading that wraps across lines',
        description: 'Final description',
        imageUrl: '',
        alt: '',
        href: ''
      }
    ],
    autoplay: false,
    loop: true,
    intervalMs: 2000
  }).config
  graph.createNode('FRAME', pageId, createCarouselModuleFrameOverrides(config))
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, devMode, router: 'none' })
  })
  const configSource = JSON.stringify(config).replaceAll('<', '\\u003c')
  if (target === 'react') {
    result.files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Carousel, {type OpenPencilCarouselConfig} from './__openpencil_carousel'
const base: OpenPencilCarouselConfig = ${configSource}
export default function App(){
  const [mounted,setMounted]=useState(true)
  const [autoplay,setAutoplay]=useState(false)
  const [loop,setLoop]=useState(true)
  const [revision,setRevision]=useState(0)
  const config={...base, slides:base.slides.map(slide=>({...slide})),autoplay,loop}
  return <main style={{padding:24}}>
    <label><input type="checkbox" checked={mounted} onChange={event=>setMounted(event.target.checked)}/>Show carousel</label>
    <label><input type="checkbox" checked={autoplay} onChange={event=>setAutoplay(event.target.checked)}/>Autoplay</label>
    <label><input type="checkbox" checked={loop} onChange={event=>setLoop(event.target.checked)}/>Loop</label>
    <button type="button" onClick={()=>setRevision(value=>value+1)}>Rerender {revision}</button>
    <button type="button">Outside focus</button>
    {mounted && <Carousel config={config} style={{position:'absolute',left:40,top:100,width:520,height:320}}/>}
  </main>
}
`
    )
  } else {
    result.files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {computed,ref} from 'vue'
import Carousel, {type OpenPencilCarouselConfig} from './__openpencil_carousel.vue'
const base: OpenPencilCarouselConfig = ${configSource}
const mounted=ref(true),autoplay=ref(false),loop=ref(true),revision=ref(0)
const config=computed(()=>({...base,slides:base.slides.map(slide=>({...slide})),autoplay:autoplay.value,loop:loop.value,revision:revision.value}))
</script>
<template><main style="padding:24px">
<label><input v-model="mounted" type="checkbox"/>Show carousel</label>
<label><input v-model="autoplay" type="checkbox"/>Autoplay</label>
<label><input v-model="loop" type="checkbox"/>Loop</label>
<button type="button" @click="revision++">Rerender {{revision}}</button><button type="button">Outside focus</button>
<Carousel v-if="mounted" :config="config" style="position:absolute;left:40px;top:100px;width:520px;height:320px"/>
</main></template>`
    )
  }
  return result
}
