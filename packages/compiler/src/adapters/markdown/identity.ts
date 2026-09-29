// mdast-util-to-hast fixes its footnote heading ID and percent-encodes note names.
// Keep those parser-owned identities local to this component, including CJK notes,
// without widening the authored URL policy or forwarding arbitrary HTML attributes.
export const MARKDOWN_IDENTITY_SOURCE = `function markdownInstancePrefix(id:string):string{
 return 'op-md-'+Array.from(id,character=>character.charCodeAt(0).toString(16)).join('-')+'-'
}
function markdownElementId(value:unknown,prefix:string):string|undefined{
 if(typeof value!=='string')return undefined
 if(value==='footnote-label')return prefix+'label'
 if(!value.startsWith(prefix))return undefined
 return prefix+Array.from(value.slice(prefix.length),character=>character.charCodeAt(0).toString(16)).join('-')
}
function markdownHref(value:string,prefix:string):string{
 if(value.startsWith('#'+prefix)){
  const id=markdownElementId(value.slice(1),prefix)
  return id?'#'+id:''
 }
 return safeHref(value)
}
function markdownDescription(value:unknown,prefix:string):string|undefined{
 const references=Array.isArray(value)?value:typeof value==='string'?value.split(/\\s+/):[]
 const ids=references.map(id=>markdownElementId(id,prefix)).filter((id):id is string=>typeof id==='string')
 return ids.length?ids.join(' '):undefined
}
function markdownBackLabel(language:string,index:number,repeated:number):string{
 return (language.toLowerCase().startsWith('zh')?'返回引用 ':'Back to reference ')+(index+1)+(repeated>1?'-'+repeated:'')
}
`
