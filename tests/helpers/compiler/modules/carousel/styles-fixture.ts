import { createCarouselModuleInstance } from '@open-pencil/core/plugins'

import { carouselRuntimeFixture } from './fixture'

const APPEARANCE_FIELDS = {
  layout: ['split', 'overlay'],
  imageFit: ['cover', 'contain', 'fill'],
  textPosition: ['top', 'center', 'bottom'],
  textAlign: ['left', 'center', 'right'],
  paginationStyle: ['dots', 'numbers', 'fraction']
} as const

export function carouselStylesFixture(target: 'react' | 'vue', devMode = true) {
  const result = carouselRuntimeFixture(target, devMode)
  const config = createCarouselModuleInstance({
    label: 'Styled work',
    layout: 'overlay',
    textPosition: 'bottom',
    textColor: '#ffffff',
    backgroundColor: '#172554',
    overlayOpacity: 0.45,
    paginationStyle: 'numbers',
    slides: Array.from({ length: 12 }, (_, index) => ({
      title: `Style ${index + 1}`,
      description: index === 1 ? 'Long copy\n'.repeat(40) : 'Readable slide description',
      imageUrl: 'https://media.example.com/style.png',
      alt: `Style image ${index + 1}`,
      href: ''
    }))
  }).config
  const base = JSON.stringify(config)
  const fields = Object.entries(APPEARANCE_FIELDS)
  if (target === 'react') {
    const controls = fields
      .map(
        ([name, values]) =>
          `<label>${name}<select aria-label="${name}" value={config.${name}} onChange={event=>setConfig(current=>({...current,${name}:event.target.value as OpenPencilCarouselConfig['${name}']}))}>${values.map((value) => `<option value="${value}">${value}</option>`).join('')}</select></label>`
      )
      .join('\n')
    result.files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Carousel,{type OpenPencilCarouselConfig} from './__openpencil_carousel'
const base:OpenPencilCarouselConfig=${base}
export default function App(){
  const [config,setConfig]=useState(base),[compact,setCompact]=useState(false),[single,setSingle]=useState(false),[nested,setNested]=useState(false)
  return <main><fieldset style={{display:'flex',gap:12,flexWrap:'wrap'}}>${controls}
    <label>Shade<input aria-label="Shade" type="number" min="0" max="0.9" step="0.1" value={config.overlayOpacity} onChange={event=>setConfig(current=>({...current,overlayOpacity:Number(event.target.value)}))}/></label>
    <label><input type="checkbox" checked={config.showDots} onChange={event=>setConfig(current=>({...current,showDots:event.target.checked}))}/>Pagination</label>
    <label><input type="checkbox" checked={compact} onChange={event=>setCompact(event.target.checked)}/>Compact</label>
    <label><input type="checkbox" checked={single} onChange={event=>setSingle(event.target.checked)}/>Single slide</label>
    <label><input type="checkbox" checked={nested} onChange={event=>setNested(event.target.checked)}/>Nested carousel</label>
  </fieldset><button type="button">Outside focus</button>
  <Carousel config={{...config,slides:single?config.slides.slice(0,1):config.slides,...(nested?{showArrows:false,autoplay:true}:{})}} style={{position:'absolute',left:40,top:150,width:compact?220:520,height:320}}>
    {nested && <Carousel config={{...base,label:'Nested split',layout:'split',autoplay:false,showArrows:true,slides:base.slides.slice(0,3)}} style={{position:'absolute',left:140,top:70,width:340,height:220,zIndex:5}}/>}
  </Carousel></main>
}`
    )
  } else {
    const controls = fields
      .map(
        ([name, values]) =>
          `<label>${name}<select aria-label="${name}" v-model="config.${name}">${values.map((value) => `<option value="${value}">${value}</option>`).join('')}</select></label>`
      )
      .join('\n')
    result.files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {reactive,ref} from 'vue'
import Carousel,{type OpenPencilCarouselConfig} from './__openpencil_carousel.vue'
const config=reactive<OpenPencilCarouselConfig>(${base}),compact=ref(false),single=ref(false),nested=ref(false)
const inner:OpenPencilCarouselConfig={...config,label:'Nested split',layout:'split',autoplay:false,showArrows:true,slides:config.slides.slice(0,3)}
</script><template><main><fieldset style="display:flex;gap:12px;flex-wrap:wrap">${controls}
<label>Shade<input aria-label="Shade" type="number" min="0" max="0.9" step="0.1" v-model.number="config.overlayOpacity"/></label>
<label><input type="checkbox" v-model="config.showDots"/>Pagination</label><label><input type="checkbox" v-model="compact"/>Compact</label><label><input type="checkbox" v-model="single"/>Single slide</label>
<label><input type="checkbox" v-model="nested"/>Nested carousel</label>
</fieldset><button type="button">Outside focus</button><Carousel :config="{...config,slides:single?config.slides.slice(0,1):config.slides,...(nested?{showArrows:false,autoplay:true}:{})}" :style="{position:'absolute',left:'40px',top:'150px',width:compact?'220px':'520px',height:'320px'}">
<Carousel v-if="nested" :config="inner" style="position:absolute;left:140px;top:70px;width:340px;height:220px;z-index:5"/>
</Carousel></main></template>`
    )
  }
  return result
}
