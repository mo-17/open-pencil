export const TOOLTIP_CONTROLLER_SOURCE = `function attachTooltip(root:HTMLElement,trigger:HTMLButtonElement,bubble:HTMLElement,getConfig:()=>OpenPencilTooltipConfig){
 let open=false,disposed=false,hoverTrigger=false,hoverBubble=false,focused=false,pinned=false,suppressed=false,pointerType=''
 let opening:ReturnType<typeof setTimeout>|undefined,closing:ReturnType<typeof setTimeout>|undefined
 const nativePopover=typeof bubble.showPopover==='function'
 const cleanups:Array<()=>void>=[]
 const clearTimers=()=>{clearTimeout(opening);clearTimeout(closing);opening=undefined;closing=undefined}
 const desired=()=>hoverTrigger||hoverBubble||focused||pinned
 const position=()=>{
  if(!open||disposed)return
  const config=getConfig(),viewport={width:document.documentElement.clientWidth,height:window.innerHeight}
  bubble.style.maxWidth=Math.max(1,Math.min(config.maxWidth,viewport.width-16))+'px'
  const padding=Math.min(10,Math.max(0,(viewport.height-16)/4))
  bubble.style.paddingBlock=padding+'px'
  const text=bubble.firstElementChild
  if(text instanceof HTMLElement)text.style.maxHeight=Math.max(0,viewport.height-16-padding*2)+'px'
  const anchor=trigger.getBoundingClientRect(),bounds=bubble.getBoundingClientRect()
  const next=tooltipPosition(anchor,bounds,viewport,config.placement,config.gap)
  bubble.dataset.tooltipSide=next.side
  if(nativePopover){bubble.style.left=next.left+'px';bubble.style.top=next.top+'px'}
  else{const host=root.getBoundingClientRect(),sx=host.width/(root.offsetWidth||host.width||1),sy=host.height/(root.offsetHeight||host.height||1)
   bubble.style.left=(next.left-host.left)/(sx||1)+'px';bubble.style.top=(next.top-host.top)/(sy||1)+'px'}
 }
 const hide=()=>{
  clearTimers();open=false;trigger.removeAttribute('aria-describedby')
  if(nativePopover&&bubble.matches(':popover-open'))bubble.hidePopover()
  bubble.hidden=true
 }
 const show=()=>{
  clearTimers();if(disposed||suppressed||!desired())return
  bubble.hidden=false;bubble.style.position=nativePopover?'fixed':'absolute'
  if(nativePopover&&!bubble.matches(':popover-open'))bubble.showPopover()
  open=true;trigger.setAttribute('aria-describedby',bubble.id);position()
 }
 const requestOpen=(immediate=false)=>{
  clearTimeout(closing);closing=undefined;clearTimeout(opening);opening=undefined
  if(suppressed||disposed)return
  if(open){position();return}
  if(immediate)show();else opening=setTimeout(show,getConfig().openDelay)
 }
 const requestClose=()=>{
  clearTimeout(opening);opening=undefined
  if(!desired()){suppressed=false;clearTimeout(closing);closing=setTimeout(hide,getConfig().closeDelay)}
 }
 function listen<K extends keyof HTMLElementEventMap>(element:HTMLElement,type:K,handler:(event:HTMLElementEventMap[K])=>void){
  element.addEventListener(type,handler);cleanups.push(()=>element.removeEventListener(type,handler))
 }
 listen(trigger,'pointerenter',event=>{if(event.pointerType==='touch')return;hoverTrigger=true;requestOpen()})
 listen(trigger,'pointerleave',()=>{hoverTrigger=false;requestClose()})
 listen(bubble,'pointerenter',()=>{hoverBubble=true;clearTimeout(closing)})
 listen(bubble,'pointerleave',()=>{hoverBubble=false;requestClose()})
 listen(trigger,'pointerdown',event=>{pointerType=event.pointerType})
 listen(trigger,'focus',()=>{if(pointerType==='touch')return;focused=true;requestOpen(true)})
 listen(trigger,'blur',()=>{focused=false;pinned=false;requestClose()})
 listen(trigger,'click',event=>{
  if(pointerType==='touch'||event.detail===0){pinned=!pinned;suppressed=!pinned;if(pinned)requestOpen(true);else hide()}
  pointerType=''
 })
 const outside=(event:PointerEvent)=>{if((open||opening!==undefined)&&event.target instanceof Node&&!root.contains(event.target)){pinned=false;suppressed=false;hide()}}
 const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&(open||opening!==undefined)){pinned=false;suppressed=desired();hide()}}
 document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape)
 document.addEventListener('scroll',position,true);window.addEventListener('resize',position)
 const viewport=window.visualViewport
 viewport?.addEventListener('resize',position);viewport?.addEventListener('scroll',position)
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(position):undefined
 observer?.observe(trigger);observer?.observe(bubble)
 if(!nativePopover)bubble.removeAttribute('popover')
 hide()
 return {
  reset(){pinned=false;hoverTrigger=false;hoverBubble=false;focused=false;suppressed=false;pointerType='';hide()},
  destroy(){disposed=true;hide();for(const cleanup of cleanups)cleanup();observer?.disconnect()
   document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape)
   document.removeEventListener('scroll',position,true);window.removeEventListener('resize',position)
   viewport?.removeEventListener('resize',position);viewport?.removeEventListener('scroll',position)}
 }
}`
