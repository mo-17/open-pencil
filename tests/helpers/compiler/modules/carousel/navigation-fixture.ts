import { createCarouselModuleInstance } from '@open-pencil/core/plugins'

import { carouselRuntimeFixture } from './fixture'

const POSITIONS = ['sides', 'top-corners', 'bottom-corners', 'bottom-left', 'bottom-right']

export function carouselNavigationFixture(target: 'react' | 'vue', devMode = true) {
  const result = carouselRuntimeFixture(target, devMode)
  const base = JSON.stringify(
    createCarouselModuleInstance({
      label: 'Navigation carousel',
      layout: 'overlay',
      textColor: '#ffffff',
      backgroundColor: '#172554',
      overlayOpacity: 0.25,
      textPosition: 'bottom',
      paginationStyle: 'numbers',
      pauseOnHover: false,
      intervalMs: 2000,
      slides: ['Explore', 'Build', 'Share'].map((title, index) => ({
        title,
        description: 'A carousel you can navigate.',
        imageUrl: 'https://media.example.com/navigation.svg',
        alt: `Landscape ${index + 1}`,
        href: ''
      }))
    }).config
  )
  const positionOptions = POSITIONS.map(
    (value) => `<option value="${value}">${value}</option>`
  ).join('')
  if (target === 'react') {
    result.files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Carousel,{type OpenPencilCarouselConfig} from './__openpencil_carousel'
const base:OpenPencilCarouselConfig=${base}
export default function App(){
 const [config,setConfig]=useState(base),[mounted,setMounted]=useState(true),[nested,setNested]=useState(false),[controls,setControls]=useState(false),[single,setSingle]=useState(false),[width,setWidth]=useState(520),[height,setHeight]=useState(320),[clicks,setClicks]=useState(0)
 return <main style={{minHeight:1600}}><fieldset style={{display:'flex',gap:12,flexWrap:'wrap'}}>
  <label>Arrow position<select aria-label="Arrow position" value={config.arrowPosition} onChange={event=>setConfig(current=>({...current,arrowPosition:event.target.value as OpenPencilCarouselConfig['arrowPosition']}))}>${positionOptions}</select></label>
  ${['autoplay', 'loop', 'showArrows', 'swipeEnabled'].map((key) => `<label><input aria-label="${key}" type="checkbox" checked={config.${key}} onChange={event=>setConfig(current=>({...current,${key}:event.target.checked}))}/>${key}</label>`).join('')}
  <label><input aria-label="Mounted" type="checkbox" checked={mounted} onChange={event=>setMounted(event.target.checked)}/>Mounted</label>
  <label><input aria-label="Nested" type="checkbox" checked={nested} onChange={event=>setNested(event.target.checked)}/>Nested</label>
  <label><input aria-label="Interactive content" type="checkbox" checked={controls} onChange={event=>setControls(event.target.checked)}/>Interactive content</label>
  <label><input aria-label="Single" type="checkbox" checked={single} onChange={event=>setSingle(event.target.checked)}/>Single</label>
  <label>Width<input aria-label="Width" type="number" value={width} onChange={event=>setWidth(Number(event.target.value))}/></label>
  <label>Height<input aria-label="Height" type="number" value={height} onChange={event=>setHeight(Number(event.target.value))}/></label>
 </fieldset><button type="button">Outside focus</button><output aria-label="Click count">{clicks}</output>
 {mounted && <Carousel config={{...config,slides:single?base.slides.slice(0,1):base.slides}} onClick={()=>setClicks(value=>value+1)} style={{position:'absolute',left:40,top:160,width,height}}>
  {controls && <div style={{position:'absolute',left:60,top:80,zIndex:5}}><button type="button">Inner action</button><input aria-label="Carousel field"/><div contentEditable suppressContentEditableWarning role="textbox" aria-label="Inline editor">Edit this text</div><a href="#local-link">Local link</a></div>}
  {nested && <Carousel config={{...base,label:'Nested navigation',autoplay:false}} style={{position:'absolute',left:230,top:60,width:260,height:220,zIndex:5}}/>}
 </Carousel>}</main>
}`
    )
  } else {
    result.files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {reactive,ref} from 'vue'
import Carousel,{type OpenPencilCarouselConfig} from './__openpencil_carousel.vue'
const base:OpenPencilCarouselConfig=${base},config=reactive({...base}),mounted=ref(true),nested=ref(false),controls=ref(false),single=ref(false),width=ref(520),height=ref(320),clicks=ref(0)
</script><template><main style="min-height:1600px"><fieldset style="display:flex;gap:12px;flex-wrap:wrap">
 <label>Arrow position<select aria-label="Arrow position" v-model="config.arrowPosition">${positionOptions}</select></label>
 ${['autoplay', 'loop', 'showArrows', 'swipeEnabled'].map((key) => `<label><input aria-label="${key}" type="checkbox" v-model="config.${key}"/>${key}</label>`).join('')}
 <label><input aria-label="Mounted" type="checkbox" v-model="mounted"/>Mounted</label><label><input aria-label="Nested" type="checkbox" v-model="nested"/>Nested</label><label><input aria-label="Interactive content" type="checkbox" v-model="controls"/>Interactive content</label><label><input aria-label="Single" type="checkbox" v-model="single"/>Single</label>
 <label>Width<input aria-label="Width" type="number" v-model.number="width"/></label><label>Height<input aria-label="Height" type="number" v-model.number="height"/></label>
</fieldset><button type="button">Outside focus</button><output aria-label="Click count">{{clicks}}</output>
<Carousel v-if="mounted" :config="{...config,slides:single?base.slides.slice(0,1):base.slides}" @click="clicks++" :style="{position:'absolute',left:'40px',top:'160px',width:width+'px',height:height+'px'}">
 <div v-if="controls" style="position:absolute;left:60px;top:80px;z-index:5"><button type="button">Inner action</button><input aria-label="Carousel field"/><div contenteditable role="textbox" aria-label="Inline editor">Edit this text</div><a href="#local-link">Local link</a></div>
 <Carousel v-if="nested" :config="{...base,label:'Nested navigation',autoplay:false}" style="position:absolute;left:230px;top:60px;width:260px;height:220px;z-index:5"/>
</Carousel></main></template>`
    )
  }
  return result
}
