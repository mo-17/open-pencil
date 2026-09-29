import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createCodeBlockModuleFrameOverrides,
  createCodeBlockModuleInstance,
  createMarkdownModuleFrameOverrides,
  createMarkdownModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { CONTENT_CODE, CONTENT_MARKDOWN } from './samples'

export function contentFixture(target: 'react' | 'vue') {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const code = createCodeBlockModuleInstance({
    label: '代码示例',
    code: CONTENT_CODE,
    wrapLines: true,
    showLineNumbers: true
  }).config
  const markdown = createMarkdownModuleInstance({ source: CONTENT_MARKDOWN }).config
  graph.createNode('FRAME', pageId, createCodeBlockModuleFrameOverrides(code))
  graph.createNode('FRAME', pageId, createMarkdownModuleFrameOverrides(markdown))
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  const shared = { code: JSON.stringify(code), markdown: JSON.stringify(markdown) }
  result.files.set(
    target === 'react' ? 'src/App.tsx' : 'src/App.vue',
    target === 'react' ? reactApp(shared) : vueApp(shared)
  )
  return result
}

function reactApp(config: { code: string; markdown: string }) {
  return `import {useState} from 'react'
import CodeBlock,{type OpenPencilCodeBlockConfig} from './__openpencil_code_block'
import Markdown,{type OpenPencilMarkdownConfig} from './__openpencil_markdown'
const initialCode:OpenPencilCodeBlockConfig=${config.code}, initialMarkdown:OpenPencilMarkdownConfig=${config.markdown}
export default function App(){const [code,setCode]=useState(initialCode),[markdown,setMarkdown]=useState(initialMarkdown),[language,setLanguage]=useState('zh-CN'),[show,setShow]=useState(true),[wide,setWide]=useState(false),[business,setBusiness]=useState('')
return <main style={{padding:16,fontFamily:'system-ui'}}>
<label>Code source<textarea aria-label="Code source" value={code.code} onChange={event=>setCode({...code,code:event.target.value})}/></label>
<label>Markdown source<textarea aria-label="Markdown source" value={markdown.source} onChange={event=>setMarkdown({...markdown,source:event.target.value})}/></label>
<input aria-label="Business input" value={business} onChange={event=>setBusiness(event.target.value)}/>
<button onClick={()=>setLanguage(language==='zh-CN'?'en':'zh-CN')}>Language</button><button onClick={()=>setShow(!show)}>Toggle code</button><button onClick={()=>setWide(!wide)}>Width</button>
<button onClick={()=>setCode({...code,wrapLines:!code.wrapLines})}>Wrap</button><button onClick={()=>setCode({...code,showLineNumbers:!code.showLineNumbers})}>Line numbers</button>
<button onClick={()=>setMarkdown({...markdown,flavor:markdown.flavor==='gfm'?'commonmark':'gfm'})}>Flavor</button><button onClick={()=>setMarkdown({...markdown,linkTarget:markdown.linkTarget==='new-tab'?'same-tab':'new-tab'})}>Link target</button>
<section aria-label="Current code">{show&&<CodeBlock config={{...code}} lang={language} style={{width:wide?720:280,maxWidth:'100%',height:360,marginTop:12}}/>}</section>
<section aria-label="Current Markdown"><Markdown config={{...markdown}} lang={language} style={{width:720,maxWidth:'100%',height:520,marginTop:20}}/></section>
<section aria-label="Other code"><CodeBlock config={initialCode} lang="en" style={{width:280,height:360,marginTop:20}}/></section>
<section aria-label="Other Markdown"><Markdown config={initialMarkdown} lang="en" style={{width:280,height:400,marginTop:20}}/></section>
</main>}`
}

function vueApp(config: { code: string; markdown: string }) {
  return `<script setup lang="ts">
import {ref} from 'vue'
import CodeBlock,{type OpenPencilCodeBlockConfig} from './__openpencil_code_block.vue'
import Markdown,{type OpenPencilMarkdownConfig} from './__openpencil_markdown.vue'
const initialCode:OpenPencilCodeBlockConfig=${config.code},initialMarkdown:OpenPencilMarkdownConfig=${config.markdown}
const code=ref({...initialCode}),markdown=ref({...initialMarkdown}),language=ref('zh-CN'),show=ref(true),wide=ref(false),business=ref('')
</script><template><main style="padding:16px;font-family:system-ui">
<label>Code source<textarea aria-label="Code source" v-model="code.code"/></label><label>Markdown source<textarea aria-label="Markdown source" v-model="markdown.source"/></label><input aria-label="Business input" v-model="business"/>
<button @click="language=language==='zh-CN'?'en':'zh-CN'">Language</button><button @click="show=!show">Toggle code</button><button @click="wide=!wide">Width</button>
<button @click="code.wrapLines=!code.wrapLines">Wrap</button><button @click="code.showLineNumbers=!code.showLineNumbers">Line numbers</button>
<button @click="markdown.flavor=markdown.flavor==='gfm'?'commonmark':'gfm'">Flavor</button><button @click="markdown.linkTarget=markdown.linkTarget==='new-tab'?'same-tab':'new-tab'">Link target</button>
<section aria-label="Current code"><CodeBlock v-if="show" :config="{...code}" :lang="language" :style="{width:wide?'720px':'280px',maxWidth:'100%',height:'360px',marginTop:'12px'}"/></section>
<section aria-label="Current Markdown"><Markdown :config="{...markdown}" :lang="language" style="width:720px;max-width:100%;height:520px;margin-top:20px"/></section>
<section aria-label="Other code"><CodeBlock :config="initialCode" lang="en" style="width:280px;height:360px;margin-top:20px"/></section>
<section aria-label="Other Markdown"><Markdown :config="initialMarkdown" lang="en" style="width:280px;height:400px;margin-top:20px"/></section>
</main></template>`
}
