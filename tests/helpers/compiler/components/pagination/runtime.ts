import { PAGINATION_MODULE_DEFAULT_CONFIG } from '@open-pencil/core/plugins'

import { paginationFixture } from './fixture'

export function paginationRuntimeFixture(target: 'react' | 'vue') {
  const result = paginationFixture(target),
    files = new Map(result.files),
    config = JSON.stringify({
      ...PAGINATION_MODULE_DEFAULT_CONFIG,
      label: 'Live pages',
      showFirstLast: true,
      total: 1000
    })
  const source =
    target === 'react'
      ? `import {useState} from 'react'
import Pagination from './__openpencil_pagination'
export default function App(){
 const [current,setCurrent]=useState<unknown>(2),[total,setTotal]=useState<unknown>(1000),[pageSize,setPageSize]=useState<unknown>(10),[disabled,setDisabled]=useState(false),[shown,setShown]=useState(true),[changes,setChanges]=useState(0),[language,setLanguage]=useState('en'),[width,setWidth]=useState(340)
 const config={...(${config} as const),disabled},style={width:width+'px',height:'48px',maxWidth:'100%'}
 return <main lang={language} style={{padding:12}}>{shown&&<Pagination config={config} currentPageBound currentPage={current} totalBound total={total} pageSizeBound pageSize={pageSize} style={style} onPageChange={v=>{setCurrent(v);setChanges(n=>n+1)}}/>}<Pagination config={{...config,label:'Independent pages'}} style={style}/><button onClick={()=>setDisabled(v=>!v)}>Disable</button><button onClick={()=>setShown(v=>!v)}>Mount</button><button onClick={()=>setTotal(0)}>Empty</button><button onClick={()=>setTotal('100')}>Invalid total</button><button onClick={()=>setTotal(1000000000)}>Huge total</button><button onClick={()=>setCurrent(100000000)}>Last page</button><button onClick={()=>setCurrent(2)}>Reset page</button><button onClick={()=>setPageSize(0)}>Bad size</button><button onClick={()=>setPageSize(20)}>Size twenty</button><button onClick={()=>setCurrent(undefined)}>Missing page</button><button onClick={()=>setLanguage(v=>v==='en'?'zh-CN':'en')}>Language</button><button onClick={()=>setWidth(180)}>Narrow</button><output>Page[{String(current)}] Changes[{changes}]</output></main>
}`
      : `<script setup lang="ts">
import {ref} from 'vue'
import Pagination from './__openpencil_pagination.vue'
const current=ref<unknown>(2),total=ref<unknown>(1000),pageSize=ref<unknown>(10),disabled=ref(false),shown=ref(true),changes=ref(0),language=ref('en'),width=ref(340),base=${config} as const
function change(value:number){current.value=value;changes.value++}
</script><template><main :lang="language" style="padding:12px"><Pagination v-if="shown" :config="{...base,disabled}" current-page-bound :current-page="current" total-bound :total="total" page-size-bound :page-size="pageSize" :style="{width:width+'px',height:'48px',maxWidth:'100%'}" @page-change="change"/><Pagination :config="{...base,disabled,label:'Independent pages'}" :style="{width:width+'px',height:'48px',maxWidth:'100%'}"/><button @click="disabled=!disabled">Disable</button><button @click="shown=!shown">Mount</button><button @click="total=0">Empty</button><button @click="total='100'">Invalid total</button><button @click="total=1000000000">Huge total</button><button @click="current=100000000">Last page</button><button @click="current=2">Reset page</button><button @click="pageSize=0">Bad size</button><button @click="pageSize=20">Size twenty</button><button @click="current=undefined">Missing page</button><button @click="language=language==='en'?'zh-CN':'en'">Language</button><button @click="width=180">Narrow</button><output>Page[{{String(current)}}] Changes[{{changes}}]</output></main></template>`
  files.set(target === 'react' ? 'src/App.tsx' : 'src/App.vue', source)
  return { files, warnings: result.warnings }
}
