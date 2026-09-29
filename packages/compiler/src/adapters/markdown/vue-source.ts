export const MARKDOWN_VUE_RENDER_SOURCE = `interface MarkdownNode {type:string;value?:string;tagName?:string;properties?:Record<string,unknown>;children?:MarkdownNode[]}
const allowedTags=new Set(['p','em','strong','del','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','pre','code','hr','br','table','thead','tbody','tr','th','td','a','img','input','sup','section'])
function markdownTree(config:OpenPencilMarkdownConfig,language:string,prefix:string){
 const processor=unified().use(remarkParse)
 if(config.flavor==='gfm')processor.use(remarkGfm)
 processor.use(remarkRehype,{allowDangerousHtml:false,clobberPrefix:prefix,footnoteLabel:language.toLowerCase().startsWith('zh')?'脚注':'Footnotes',footnoteBackLabel:(index,repeated)=>markdownBackLabel(language,index,repeated)})
 return processor.runSync(processor.parse(config.source)) as MarkdownNode
}
function renderMarkdownNode(node:MarkdownNode,config:OpenPencilMarkdownConfig,language:string,prefix:string):VNodeChild{
 if(node.type==='text')return node.value??''
 if(node.type==='root')return node.children?.map(child=>renderMarkdownNode(child,config,language,prefix))??[]
 if(node.type!=='element'||!node.tagName||!allowedTags.has(node.tagName))return null
 const tag=node.tagName,source=node.properties??{}
 const children=node.children?.map(child=>renderMarkdownNode(child,config,language,prefix))??[]
 if(tag==='img'){
  const label=typeof source.alt==='string'&&source.alt.trim()?source.alt.trim():(language.toLowerCase().startsWith('zh')?'Markdown 图片':'Markdown image')
  return h('span',{'data-openpencil-markdown-image':'',role:'img','aria-label':label},'['+label+']')
 }
 const attrs:Record<string,unknown>={}
 if(typeof source.title==='string')attrs.title=source.title
 attrs.id=markdownElementId(source.id,prefix)
 if(source.dataFootnotes===true)attrs['data-footnotes']=''
 if(Array.isArray(source.className))attrs.class=source.className.filter(value=>typeof value==='string').join(' ')
 if(tag==='a'){
  const href=markdownHref(typeof source.href==='string'?source.href:'',prefix)
  if(!href)return h('span',{},children)
  attrs.href=href
  const reference=source.dataFootnoteRef===true,backreference=source.dataFootnoteBackref===''
  if(reference)attrs['data-footnote-ref']=''
  if(backreference)attrs['data-footnote-backref']=''
  if(config.linkTarget==='new-tab'&&!reference&&!backreference){attrs.target='_blank';attrs.rel='nofollow noopener noreferrer'}
  if(typeof source.ariaLabel==='string')attrs['aria-label']=source.ariaLabel
  attrs['aria-describedby']=markdownDescription(source.ariaDescribedBy,prefix)
 }
 if(tag==='ol'&&typeof source.start==='number')attrs.start=source.start
 if(tag==='th')attrs.scope='col'
 if((tag==='th'||tag==='td')&&['left','center','right'].includes(String(source.align)))attrs.style={textAlign:source.align}
 if(tag==='input')return h('input',{type:'checkbox',disabled:true,checked:source.checked===true})
 const result=h(tag,attrs,children)
 return tag==='table'?h('div',{'data-markdown-table':''},[result]):result
}
`
