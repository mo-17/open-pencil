import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createDateRangeModuleFrameOverrides,
  createDateRangeModuleInstance,
  createRatingModuleFrameOverrides,
  createRatingModuleInstance,
  createSliderModuleFrameOverrides,
  createSliderModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function formModulesFixture(target: 'react' | 'vue') {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const slider = { label: 'Linked range', range: true, initialValue: 20, initialEndValue: 80 }
  const rating = { label: 'Linked rating', initialValue: 3, allowHalf: true }
  const date = { label: 'Linked dates', min: '2026-01-01', max: '2026-12-31' }
  for (const overrides of [
    createSliderModuleFrameOverrides(slider),
    createRatingModuleFrameOverrides(rating),
    createDateRangeModuleFrameOverrides(date)
  ]) {
    graph.createNode('FRAME', page.id, overrides)
  }
  const result = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  const configs = `const slider=${JSON.stringify(createSliderModuleInstance(slider).config)},rating=${JSON.stringify(createRatingModuleInstance(rating).config)},date=${JSON.stringify(createDateRangeModuleInstance(date).config)}`
  const source =
    target === 'react'
      ? `import {useState} from 'react'
import Slider from './__openpencil_slider'
import Rating from './__openpencil_rating'
import DateRange from './__openpencil_date_range'
${configs}
export default function App(){
 const [first,setFirst]=useState<unknown>(20),[last,setLast]=useState<unknown>(80),[score,setScore]=useState<unknown>(3),[start,setStart]=useState<unknown>('2026-09-01'),[end,setEnd]=useState<unknown>('2026-09-05')
 const [changes,setChanges]=useState(0),[blurs,setBlurs]=useState(''),[submitted,setSubmitted]=useState(''),[readonly,setReadonly]=useState(false),[disabled,setDisabled]=useState(false),[mounted,setMounted]=useState(true),[cancel,setCancel]=useState(false),[error,setError]=useState('')
 const changed=<T,>(set:(value:T)=>void)=>(value:T)=>{set(value);setChanges(n=>n+1)}
 const field=(name:string,reset:()=>void,required=false)=>({name,required,validationKey:name,validationScopeMarker:true,onBlur:()=>setBlurs(name),onReset:reset,...(name==='end'&&error?{invalid:true,error,describedBy:'end-error'}:{})})
 function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setSubmitted(JSON.stringify([...new FormData(event.currentTarget)]))}
 return <main lang="en"><form id="main-form" onSubmit={submit} onReset={event=>{if(cancel)event.preventDefault()}}>
 {mounted&&<><Slider config={slider} valueBound value={first} onValueChange={changed(setFirst)} endValueBound endValue={last} onEndValueChange={changed(setLast)} field={field('low',()=>setFirst(20),true)} endField={field('high',()=>setLast(80),true)} readOnly={readonly} disabled={disabled} style={{width:340}}/>
 <Rating config={rating} valueBound value={score} onValueChange={changed(setScore)} field={field('score',()=>setScore(3),true)} readOnly={readonly} disabled={disabled} style={{width:300}}/>
 <DateRange config={date} valueBound value={start} onValueChange={changed(setStart)} endValueBound endValue={end} onEndValueChange={changed(setEnd)} field={field('start',()=>setStart('2026-09-01'),true)} endField={field('end',()=>{setEnd('2026-09-05');setError('')},true)} readOnly={readonly} disabled={disabled} style={{width:340}}/></>}
 <Rating config={{...rating,label:'Local rating'}} style={{width:300}}/><button type="submit">Submit</button><button type="reset">Reset</button></form>
 <form id="external-form" onSubmit={submit}><button type="submit">Submit external</button></form>
 <Rating config={{...rating,label:'External rating'}} field={{name:'external'}} form="external-form" style={{width:300}}/>
 <form id="unrelated-form" onSubmit={submit}><Rating config={{...rating,label:'Detached rating',initialValue:0}} field={{name:'detached',required:true}} form="" style={{width:300}}/><button type="submit">Submit unrelated</button></form>
 <button onClick={()=>setReadonly(v=>!v)}>Read only</button><button onClick={()=>setDisabled(v=>!v)}>Disabled</button><button onClick={()=>setCancel(v=>!v)}>Cancel reset</button><button onClick={()=>setMounted(v=>!v)}>Mount</button>
 <button onClick={()=>{setFirst(undefined);setLast('80');setScore(99);setStart('2026-02-30');setEnd(undefined)}}>Invalid values</button><button onClick={()=>setScore(0)}>Zero rating</button><button onClick={()=>setError('End field rejected')}>Server error</button>
 <output data-values="">Values[{String(first)},{String(last)},{String(score)},{String(start)},{String(end)}] Changes[{changes}] Blur[{blurs}]</output><output data-submission="">{submitted}</output></main>
}`
      : `<script setup lang="ts">
import {ref} from 'vue'
import Slider from './__openpencil_slider.vue'
import Rating from './__openpencil_rating.vue'
import DateRange from './__openpencil_date_range.vue'
${configs}
const first=ref<unknown>(20),last=ref<unknown>(80),score=ref<unknown>(3),start=ref<unknown>('2026-09-01'),end=ref<unknown>('2026-09-05'),changes=ref(0),blurs=ref(''),submitted=ref(''),readonly=ref(false),disabled=ref(false),mounted=ref(true),cancel=ref(false),error=ref('')
function change(key:'first'|'last'|'score'|'start'|'end',value:unknown){({first,last,score,start,end})[key].value=value;changes.value++}
function field(name:string,reset:()=>void,required=false){return {name,required,validationKey:name,validationScopeMarker:true,onBlur:()=>{blurs.value=name},onReset:reset,...(name==='end'&&error.value?{invalid:true,error:error.value,describedBy:'end-error'}:{})}}
function submit(event:Event){event.preventDefault();if(event.currentTarget instanceof HTMLFormElement)submitted.value=JSON.stringify([...new FormData(event.currentTarget)])}
</script><template><main lang="en"><form id="main-form" @submit="submit" @reset="cancel&&$event.preventDefault()">
<template v-if="mounted"><Slider :config="slider" value-bound :value="first" @value-change="change('first',$event)" end-value-bound :end-value="last" @end-value-change="change('last',$event)" :field="field('low',()=>first=20,true)" :end-field="field('high',()=>last=80,true)" :read-only="readonly" :disabled="disabled" style="width:340px"/>
<Rating :config="rating" value-bound :value="score" @value-change="change('score',$event)" :field="field('score',()=>score=3,true)" :read-only="readonly" :disabled="disabled" style="width:300px"/>
<DateRange :config="date" value-bound :value="start" @value-change="change('start',$event)" end-value-bound :end-value="end" @end-value-change="change('end',$event)" :field="field('start',()=>start='2026-09-01',true)" :end-field="field('end',()=>{end='2026-09-05';error=''},true)" :read-only="readonly" :disabled="disabled" style="width:340px"/></template>
<Rating :config="{...rating,label:'Local rating'}" style="width:300px"/><button type="submit">Submit</button><button type="reset">Reset</button></form>
<form id="external-form" @submit="submit"><button type="submit">Submit external</button></form><Rating :config="{...rating,label:'External rating'}" :field="{name:'external'}" form="external-form" style="width:300px"/>
<form id="unrelated-form" @submit="submit"><Rating :config="{...rating,label:'Detached rating',initialValue:0}" :field="{name:'detached',required:true}" form="" style="width:300px"/><button type="submit">Submit unrelated</button></form>
<button @click="readonly=!readonly">Read only</button><button @click="disabled=!disabled">Disabled</button><button @click="cancel=!cancel">Cancel reset</button><button @click="mounted=!mounted">Mount</button><button @click="first=undefined;last='80';score=99;start='2026-02-30';end=undefined">Invalid values</button><button @click="score=0">Zero rating</button><button @click="error='End field rejected'">Server error</button>
<output data-values="">Values[{{String(first)}},{{String(last)}},{{String(score)}},{{String(start)}},{{String(end)}}] Changes[{{changes}}] Blur[{{blurs}}]</output><output data-submission="">{{submitted}}</output></main></template>`
  result.files.set(target === 'react' ? 'src/App.tsx' : 'src/App.vue', source)
  return result
}
