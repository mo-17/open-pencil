/** The two framework adapters share one imperative, instance-owned dialog controller. */
export const WALKTOUR_CONTROLLER_SOURCE = `function attachWalktour(root:HTMLElement,trigger:HTMLButtonElement,dialog:HTMLDialogElement,status:HTMLElement,getConfig:()=>OpenPencilWalktourConfig){
 const panel=dialog.querySelector<HTMLElement>('[data-walktour-panel]')!,title=dialog.querySelector<HTMLElement>('[data-walktour-title]')!,content=dialog.querySelector<HTMLElement>('[data-walktour-content]')!,reason=dialog.querySelector<HTMLElement>('[data-walktour-reason]')!,progress=dialog.querySelector<HTMLElement>('[data-walktour-progress]')!,highlight=dialog.querySelector<HTMLElement>('[data-walktour-highlight]')!,mask=dialog.querySelector<SVGPathElement>('[data-walktour-mask] path')!
 const closeButton=dialog.querySelector<HTMLButtonElement>('[data-walktour-close]')!,previous=dialog.querySelector<HTMLButtonElement>('[data-walktour-action=previous]')!,next=dialog.querySelector<HTMLButtonElement>('[data-walktour-action=next]')!,skip=dialog.querySelector<HTMLButtonElement>('[data-walktour-action=skip]')!,restart=dialog.querySelector<HTMLButtonElement>('[data-walktour-action=restart]')!
 let open=false,disposed=false,index=0,frame:number|undefined,key=walktourKey(getConfig())
 function close(restore=false){
  const focused=document.activeElement,owns=dialog.contains(focused),outside=focused instanceof HTMLElement&&!owns?focused:null
  open=false;if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined
  trigger.setAttribute('aria-expanded','false');dialog.removeAttribute('data-walktour-open')
  if(dialog.open&&typeof dialog.close==='function')dialog.close()
  dialog.removeAttribute('open')
  if(restore&&owns&&!disposed&&trigger.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true})
  else if(outside?.isConnected&&document.activeElement!==outside)outside.focus({preventScroll:true})
 }
 function configCurrent(){if(key===walktourKey(getConfig()))return true;key=walktourKey(getConfig());close(true);status.textContent='';return false}
 function paint(){
  const config=getConfig(),step=config.steps[index],copy=walktourCopy(root)
  if(!step)return
  title.textContent=step.title;content.textContent=step.content;closeButton.setAttribute('aria-label',copy.close)
  previous.textContent=copy.previous;previous.disabled=index===0;next.textContent=index===config.steps.length-1?copy.finish:copy.next
  skip.textContent=copy.skip;skip.hidden=!config.showSkip;restart.textContent=copy.restart;restart.hidden=index===0
  progress.textContent=copy.step+' '+(index+1)+' '+copy.of+' '+config.steps.length;progress.hidden=!config.showProgress
  dialog.dataset.walktourStep=step.id
 }
 function position(){
  frame=undefined;if(disposed||!open||!configCurrent())return
  const config=getConfig(),step=config.steps[index];if(!step)return
  paint()
  const viewport=walktourViewport(),target=step.targetChildName?walktourTarget(root,step.id,viewport):null,unavailable=Boolean(step.targetChildName&&!target)
  reason.hidden=!unavailable;reason.textContent=unavailable?walktourCopy(root).unavailable:''
  panel.style.width=Math.max(1,Math.min(config.panelWidth,viewport.width-16))+'px';panel.style.maxHeight=Math.max(1,viewport.height-16)+'px'
  panel.style.padding=Math.min(16,Math.max(0,(Math.min(viewport.width,viewport.height)-18)/4))+'px'
  const size=panel.getBoundingClientRect(),point=target?floatingPosition({left:target.left-viewport.left,top:target.top-viewport.top,width:target.width,height:target.height},size,viewport,step.placement,12):{left:(viewport.width-size.width)/2,top:(viewport.height-size.height)/2,side:'center'}
  panel.style.left=Math.max(viewport.left,Math.min(viewport.left+point.left,viewport.left+viewport.width-size.width))+'px';panel.style.top=Math.max(viewport.top,Math.min(viewport.top+point.top,viewport.top+viewport.height-size.height))+'px'
  panel.dataset.walktourSide=point.side;panel.dataset.walktourTarget=target?'available':unavailable?'unavailable':'overview'
  mask.setAttribute('d',walktourMask(viewport,target));mask.setAttribute('fill','#000000');mask.setAttribute('fill-opacity',String(config.overlayOpacity))
  highlight.hidden=!target;if(target){highlight.style.left=target.left+'px';highlight.style.top=target.top+'px';highlight.style.width=target.width+'px';highlight.style.height=target.height+'px'}
 }
 function schedule(){if(open&&!disposed&&frame===undefined)frame=requestAnimationFrame(position)}
 function show(event:MouseEvent){
  event.stopPropagation();if(disposed||getConfig().disabled||trigger.disabled)return
  if(open){close(true);return}
  key=walktourKey(getConfig());index=0;status.textContent='';paint()
  try{if(typeof dialog.showModal!=='function')throw new Error('Unavailable');dialog.showModal();if(!dialog.open)throw new Error('Not opened')}
  catch{close();status.textContent=walktourCopy(root).unsupported;return}
  open=true;dialog.dataset.walktourOpen='';trigger.setAttribute('aria-expanded','true');position();closeButton.focus({preventScroll:true})
 }
 function action(event:MouseEvent){
  event.stopPropagation();if(disposed||!open||!configCurrent()||!(event.target instanceof Element))return
  const button=event.target.closest<HTMLButtonElement>('[data-walktour-action],[data-walktour-close]')
  if(!button||!dialog.contains(button)||button.disabled)return
  if(button.hasAttribute('data-walktour-close')){close(true);return}
  const value=button.dataset.walktourAction,config=getConfig(),copy=walktourCopy(root)
  if(value==='skip'||(value==='next'&&index===config.steps.length-1)){close(true);status.textContent=value==='skip'?copy.skipped:copy.finished;return}
  if(value==='previous')index=Math.max(0,index-1)
  else if(value==='next')index=Math.min(config.steps.length-1,index+1)
  else if(value==='restart')index=0
  else return
  position();closeButton.focus({preventScroll:true})
 }
 function keyboard(event:KeyboardEvent){
  if(!open)return
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return}
  if(event.key!=='Tab')return
  const controls=Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).filter(button=>!button.disabled&&!button.hidden&&button.getClientRects().length),first=controls[0],last=controls[controls.length-1]
  if(!first){event.preventDefault();panel.focus();return}
  if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
 }
 const cancel=(event:Event)=>{event.preventDefault();event.stopPropagation();if(open)close(true)}
 const closed=()=>{if(open&&!dialog.open)close(true)}
 trigger.addEventListener('click',show);dialog.addEventListener('click',action);dialog.addEventListener('keydown',keyboard);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',closed)
 document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule)
 const viewport=window.visualViewport;viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule)
 const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(schedule);resize?.observe(root);resize?.observe(panel)
 const mutation=typeof MutationObserver==='undefined'?undefined:new MutationObserver(records=>{if(records.some(record=>!dialog.contains(record.target)&&record.target!==status&&record.target!==trigger))schedule()})
 mutation?.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden']})
 const language=typeof MutationObserver==='undefined'?undefined:new MutationObserver(schedule);language?.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['lang']})
 return {reset(){key=walktourKey(getConfig());close(true);status.textContent=''},destroy(){disposed=true;close();resize?.disconnect();mutation?.disconnect();language?.disconnect();trigger.removeEventListener('click',show);dialog.removeEventListener('click',action);dialog.removeEventListener('keydown',keyboard);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',closed);document.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule)}}
}`
