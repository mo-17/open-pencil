/** One DOM controller keeps React and Vue dismissal and focus semantics identical. */
export const POPOVER_CONTROLLER_SOURCE = `function attachPopover(root:HTMLElement,trigger:HTMLButtonElement,panel:HTMLElement,status:HTMLElement,getConfig:()=>OpenPencilPopoverConfig){
 let open=false,disposed=false,epoch=0,nativePopover=typeof panel.showPopover==='function',focusTimer:number|undefined
 const cleanups:Array<()=>void>=[]
 const contains=(target:EventTarget|null)=>target instanceof Node&&(trigger.contains(target)||panel.contains(target))
 const position=()=>{
  if(!open||disposed)return
  const config=getConfig(),viewport={width:document.documentElement.clientWidth,height:window.innerHeight}
  panel.style.width=Math.max(1,Math.min(config.panelWidth,viewport.width-16))+'px'
  panel.style.maxHeight=Math.max(1,viewport.height-16)+'px'
  panel.style.padding=Math.min(16,Math.max(0,(Math.min(viewport.width,viewport.height)-18)/4))+'px'
  const point=floatingPosition(trigger.getBoundingClientRect(),panel.getBoundingClientRect(),viewport,config.placement,config.gap)
  panel.dataset.popoverSide=point.side
  if(nativePopover){panel.style.left=point.left+'px';panel.style.top=point.top+'px'}
  else{const bounds=root.getBoundingClientRect(),sx=bounds.width/(root.offsetWidth||bounds.width||1),sy=bounds.height/(root.offsetHeight||bounds.height||1)
   panel.style.left=(point.left-bounds.left)/(sx||1)+'px';panel.style.top=(point.top-bounds.top)/(sy||1)+'px'}
 }
 const close=(restore=false)=>{
  ++epoch;window.clearTimeout(focusTimer);focusTimer=undefined;open=false;trigger.setAttribute('aria-expanded','false')
  if(nativePopover&&panel.matches(':popover-open'))panel.hidePopover()
  panel.hidden=true
  if(restore&&!disposed&&trigger.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true})
 }
 const show=()=>{
  if(disposed||getConfig().disabled||trigger.disabled)return
  ++epoch;status.textContent='';panel.hidden=false
  const closeButton=panel.querySelector('[data-popover-close]')
  closeButton?.setAttribute('aria-label',popoverCopy(root).close)
  if(nativePopover){try{panel.showPopover()}catch{nativePopover=false;panel.removeAttribute('popover')}}
  panel.style.position=nativePopover?'fixed':'absolute'
  open=true;trigger.setAttribute('aria-expanded','true');position()
  panel.focus({preventScroll:true})
 }
 const result=(value:'confirmed'|'cancelled')=>{
  if(!open||disposed)return
  close(true);status.textContent=popoverCopy(root)[value]
 }
 function listen<K extends keyof HTMLElementEventMap>(element:HTMLElement,type:K,handler:(event:HTMLElementEventMap[K])=>void){
  element.addEventListener(type,handler);cleanups.push(()=>element.removeEventListener(type,handler))
 }
 listen(trigger,'click',()=>{if(open)close(true);else show()})
 listen(panel,'click',event=>{
  if(!(event.target instanceof Element))return
  const button=event.target.closest<HTMLElement>('[data-popover-action],[data-popover-close]')
  if(!button||button.closest('[data-popover-panel]')!==panel)return
  event.stopPropagation()
  if(button.hasAttribute('data-popover-close'))close(true)
  else if(button.dataset.popoverAction==='confirm')result('confirmed')
  else if(button.dataset.popoverAction==='cancel')result('cancelled')
 })
 const outside=(event:PointerEvent)=>{if(open&&!contains(event.target))close(false)}
 const focusOutside=(event:FocusEvent)=>{if(open&&!contains(event.target))close(false)}
 const escape=(event:KeyboardEvent)=>{const active=document.activeElement;const ownsFocus=active===trigger||(active instanceof Element&&active.closest('[data-popover-panel]')===panel);if(open&&event.key==='Escape'&&ownsFocus){event.preventDefault();event.stopPropagation();close(true)}}
 const leaving=(event:FocusEvent)=>{
  if(contains(event.relatedTarget))return
  if(event.relatedTarget){close(false);return}
  const expected=epoch;window.clearTimeout(focusTimer)
  focusTimer=window.setTimeout(()=>{focusTimer=undefined;if(!disposed&&open&&epoch===expected&&!contains(document.activeElement))close(false)},0)
 }
 listen(panel,'focusout',leaving);listen(trigger,'focusout',leaving)
 document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',focusOutside,true)
 document.addEventListener('keydown',escape);document.addEventListener('scroll',position,true);window.addEventListener('resize',position)
 const viewport=window.visualViewport
 viewport?.addEventListener('resize',position);viewport?.addEventListener('scroll',position)
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(position):undefined
 observer?.observe(trigger);observer?.observe(panel)
 if(!nativePopover)panel.removeAttribute('popover')
 close()
 return {
  reset(){const restore=open&&panel.contains(document.activeElement);close(restore);status.textContent=''},
  destroy(){disposed=true;close();for(const cleanup of cleanups)cleanup();observer?.disconnect()
   document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',focusOutside,true);document.removeEventListener('keydown',escape)
   document.removeEventListener('scroll',position,true);window.removeEventListener('resize',position)
   viewport?.removeEventListener('resize',position);viewport?.removeEventListener('scroll',position)}
 }
}`
