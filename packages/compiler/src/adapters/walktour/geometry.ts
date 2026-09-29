export const WALKTOUR_GEOMETRY_SOURCE = `
function intersectWalktourRect(a:FloatingBox,b:FloatingBox):FloatingBox|null{
 const left=Math.max(a.left,b.left),top=Math.max(a.top,b.top),right=Math.min(a.left+a.width,b.left+b.width),bottom=Math.min(a.top+a.height,b.top+b.height)
 return right>left&&bottom>top?{left,top,width:right-left,height:bottom-top}:null
}
function visibleWalktourRect(element:Element,viewport:FloatingBox):FloatingBox|null{
 let rect:FloatingBox|null=intersectWalktourRect(element.getBoundingClientRect(),viewport)
 if(!rect||!element.getClientRects().length)return null
 for(let current:Element|null=element;current;current=current.parentElement){
  const style=getComputedStyle(current)
  if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0||current.hasAttribute('hidden'))return null
  if(current!==element&&/(hidden|clip|auto|scroll)/.test(style.overflow+style.overflowX+style.overflowY)){
   const box=current.getBoundingClientRect(),clip={left:box.left,top:box.top,width:box.width,height:box.height}
   rect=intersectWalktourRect(rect,clip);if(!rect)return null
  }
 }
 return rect
}
function walktourTarget(root:HTMLElement,id:string,viewport:FloatingBox):FloatingBox|null{
 const wrapper=Array.from(root.children).find(element=>element.getAttribute('data-walktour-slot')==='target-'+id)
 if(!wrapper)return null
 const roots=Array.from(wrapper.children).filter(element=>!['STYLE','SCRIPT','LINK','TEMPLATE'].includes(element.tagName)),rects=roots.flatMap(element=>visibleWalktourRect(element,viewport)??[])
 if(!rects.length)return null
 const left=Math.min(...rects.map(rect=>rect.left)),top=Math.min(...rects.map(rect=>rect.top)),right=Math.max(...rects.map(rect=>rect.left+rect.width)),bottom=Math.max(...rects.map(rect=>rect.top+rect.height))
 return {left,top,width:right-left,height:bottom-top}
}
function walktourViewport(){const viewport=window.visualViewport;return {left:viewport?.offsetLeft??0,top:viewport?.offsetTop??0,width:viewport?.width??document.documentElement.clientWidth,height:viewport?.height??window.innerHeight}}
function walktourMask(viewport:FloatingBox,target:FloatingBox|null):string{
 const outer='M'+viewport.left+' '+viewport.top+'h'+viewport.width+'v'+viewport.height+'h-'+viewport.width+'z'
 return target?outer+' M'+target.left+' '+target.top+'h'+target.width+'v'+target.height+'h-'+target.width+'z':outer
}
`
