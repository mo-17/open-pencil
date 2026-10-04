import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createAudioPlayerModuleInstance,
  createLottieModuleInstance,
  createQrBarcodeModuleInstance,
  resolveAudioPlayerModule,
  resolveLottieModule,
  resolveQrBarcodeModule
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export const MEDIA_ANIMATION = {
  v: '5.13.0',
  fr: 30,
  ip: 0,
  op: 60,
  w: 120,
  h: 120,
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'Safe square',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [60, 60, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] }
      },
      shapes: [
        { ty: 'rc', d: 1, s: { a: 0, k: [60, 60] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 8 } },
        { ty: 'fl', c: { a: 0, k: [0.1, 0.4, 0.8, 1] }, o: { a: 0, k: 100 }, r: 1 }
      ],
      ip: 0,
      op: 60,
      st: 0,
      bm: 0
    }
  ]
}
export const MEDIA_REMOTE_URL = 'https://animations.example.com/vue-media.json'

export function mediaConfigs() {
  const audio = resolveAudioPlayerModule(
    createAudioPlayerModuleInstance({
      src: '/media/local-tone.wav',
      title: 'Local audio',
      artist: '<b>Plain artist</b>',
      volume: 0.35,
      playbackRate: 1.25,
      muted: true
    })
  )
  const lottie = resolveLottieModule(
    createLottieModuleInstance({
      source: 'json',
      data: MEDIA_ANIMATION,
      autoplay: true,
      loop: true
    })
  )
  const remote = resolveLottieModule(
    createLottieModuleInstance({ source: 'url', url: MEDIA_REMOTE_URL })
  )
  const qr = resolveQrBarcodeModule(
    createQrBarcodeModuleInstance({
      value: 'https://example.com/',
      caption: '<b>Plain caption</b>'
    })
  )
  const barcode = resolveQrBarcodeModule(
    createQrBarcodeModuleInstance({ format: 'code128', value: 'ABC-123', caption: 'Code 128' })
  )
  if (!audio?.ok || !lottie?.ok || !remote?.ok || !qr?.ok || !barcode?.ok)
    throw new Error('Invalid media fixture')
  return {
    audio: audio.config,
    lottie: lottie.config,
    remote: remote.config,
    qr: qr.config,
    barcode: barcode.config
  }
}

/** A tiny PCM WAV uses only ASCII bytes, so preview VFS can serve the exact local artifact. */
export function mediaWav(): string {
  const bytes = new Uint8Array(68),
    view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 60, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, 24, true)
  bytes.fill(127, 44)
  return String.fromCharCode(...bytes)
}

export function vueMediaFixture(devMode = true, target: 'react' | 'vue' = 'vue') {
  const graph = new SceneGraph(),
    page = graph.getPages()[0],
    config = mediaConfigs()
  const modules = [
    createAudioPlayerModuleInstance(config.audio),
    createLottieModuleInstance(config.lottie),
    createLottieModuleInstance(config.remote),
    createQrBarcodeModuleInstance(config.qr),
    createQrBarcodeModuleInstance(config.barcode)
  ]
  modules.forEach((module, index) => {
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Media ' + index,
      width: 320,
      height: index === 0 ? 120 : 200,
      x: 16,
      y: 16 + index * 240,
      interactiveProps: { module }
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Authored child',
      text: 'Authored media child',
      width: 150,
      height: 24
    })
  })
  const output = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode })
  })
  output.files.set('public/media/local-tone.wav', mediaWav())
  return output
}

/** Generated-project harness exercises config updates, library drawing and unmount boundaries. */
export function vueMediaBrowserFixture(devMode = true) {
  const output = vueMediaFixture(devMode),
    config = mediaConfigs()
  output.files.set(
    'src/pages/index.vue',
    `<script setup lang="ts">
import { ref } from 'vue'
import Audio from '../__openpencil_audio_player.vue'
import Lottie from '../__openpencil_lottie.vue'
import Code from '../__openpencil_qr_barcode.vue'
const visible=ref(true),revision=ref(0)
const audio=ref<InstanceType<typeof Audio>['$props']['config']>(${JSON.stringify(config.audio)})
const lottie=ref<InstanceType<typeof Lottie>['$props']['config']>(${JSON.stringify(config.lottie)})
const remote=ref<InstanceType<typeof Lottie>['$props']['config']>(${JSON.stringify(config.remote)})
const qr=ref<InstanceType<typeof Code>['$props']['config']>(${JSON.stringify(config.qr)})
const barcode=ref<InstanceType<typeof Code>['$props']['config']>(${JSON.stringify(config.barcode)})
function changeAudio(){audio.value={...audio.value,src:'/media/replacement.wav',volume:.6,playbackRate:1.5}}
function changeCodes(){qr.value={...qr.value,value:'Vue QR updated'};barcode.value={...barcode.value,value:'UPDATED-456'}}
function changeRemote(){remote.value={...remote.value,url:'https://animations.example.com/replacement.json'}}
function repairAnimation(){lottie.value={...lottie.value,data:${JSON.stringify(MEDIA_ANIMATION)}}}
function invalidAnimation(){lottie.value={...lottie.value,data:{...lottie.value.data,layers:[{ty:6}]}}}
</script>
<template><main><nav><button @click="changeAudio">Change audio</button><button @click="changeCodes">Change codes</button><button @click="changeRemote">Change remote</button><button @click="invalidAnimation">Invalid animation</button><button @click="repairAnimation">Repair animation</button><button @click="revision++">Rerender</button><button @click="visible=!visible">Toggle media</button></nav><p>Revision: {{revision}}</p><section v-if="visible">
<Audio :config="audio" style="width:320px;height:120px"><em>Authored audio child</em></Audio>
<Lottie :config="lottie" style="width:320px;height:200px"><em>Authored animation child</em></Lottie>
<Lottie :config="remote" style="width:320px;height:200px"/>
<Code :config="qr" style="width:320px;height:220px"/><Code :config="barcode" style="width:320px;height:220px"/>
</section></main></template>
<style>body{margin:0}main{box-sizing:border-box;max-width:100%;padding:16px}nav{display:flex;flex-wrap:wrap;gap:8px}section{display:grid;gap:12px;max-width:100%}section>div{max-width:100%;box-sizing:border-box}em{position:absolute;bottom:0;left:0;font:10px system-ui}</style>`
  )
  return output
}
