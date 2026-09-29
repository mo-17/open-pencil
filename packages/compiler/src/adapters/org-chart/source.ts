export const ORG_CHART_CONFIG_SOURCE = `interface OrgChartItem {id:string;parentId:string;label:string;description:string}
export interface OpenPencilOrgChartConfig {label:string;items:readonly OrgChartItem[];direction:'vertical'|'horizontal';collapsible:boolean;initialCollapsedIds:readonly string[];backgroundColor:string;cardColor:string;textColor:string;mutedColor:string;accentColor:string;borderColor:string;connectorColor:string;fontSize:number;borderRadius:number}
interface OrgChartCard extends OrgChartItem {x:number;y:number;width:number;height:number;depth:number;hasChildren:boolean;collapsed:boolean}
interface OrgChartConnector {fromId:string;toId:string;points:{x:number;y:number}[]}
interface OrgChartLayout {cards:OrgChartCard[];connectors:OrgChartConnector[];width:number;height:number;mode:'tree'|'compact'}
interface OrgChartState {collapsed:string[];activeId:string}
`

export const ORG_CHART_STATE_SOURCE = `
function orgChartKey(config:OpenPencilOrgChartConfig):string{return JSON.stringify(config)}
function initialOrgChart(config:OpenPencilOrgChartConfig):OrgChartState{return {collapsed:config.collapsible?[...config.initialCollapsedIds]:[],activeId:''}}
function orgChartActive(cards:readonly OrgChartCard[],id:string,items:readonly OrgChartItem[]):string{
 const visible=new Set(cards.map(card=>card.id)),byId=new Map(items.map(item=>[item.id,item])),seen=new Set<string>()
 let current=id
 while(current&&!seen.has(current)){if(visible.has(current))return current;seen.add(current);current=byId.get(current)?.parentId??''}
 return cards[0]?.id??''
}
function orgChartToggle(config:OpenPencilOrgChartConfig,state:OrgChartState,id:string):OrgChartState{
 if(!config.collapsible||!config.items.some(item=>item.parentId===id))return state
 return {activeId:id,collapsed:state.collapsed.includes(id)?state.collapsed.filter(value=>value!==id):[...state.collapsed,id]}
}
function orgChartKeyboard(config:OpenPencilOrgChartConfig,state:OrgChartState,cards:readonly OrgChartCard[],key:string):{state:OrgChartState;handled:boolean}{
 const id=orgChartActive(cards,state.activeId,config.items),index=cards.findIndex(card=>card.id===id),card=cards[index]
 if(!card)return {state,handled:false}
 let active=id,next=state
 switch(key){
  case 'ArrowDown':active=cards[Math.min(cards.length-1,index+1)].id;break
  case 'ArrowUp':active=cards[Math.max(0,index-1)].id;break
  case 'Home':active=cards[0].id;break
  case 'End':active=cards[cards.length-1].id;break
  case 'ArrowRight':if(card.hasChildren&&card.collapsed)next=orgChartToggle(config,state,id);else if(cards[index+1]?.parentId===id)active=cards[index+1].id;break
  case 'ArrowLeft':if(card.hasChildren&&!card.collapsed&&config.collapsible)next=orgChartToggle(config,state,id);else if(card.parentId)active=card.parentId;break
  case 'Enter':case ' ':next=orgChartToggle(config,state,id);break
  default:return {state,handled:false}
 }
 return {state:{...next,activeId:active},handled:true}
}
function orgChartSiblings(config:OpenPencilOrgChartConfig,card:OrgChartCard){const siblings=config.items.filter(item=>item.parentId===card.parentId);return {position:siblings.findIndex(item=>item.id===card.id)+1,size:siblings.length}}
function orgChartCopy(lang:string|undefined){return /^zh(?:-|$)/i.test(lang??'')?{expand:'展开',collapse:'收起',help:'方向键浏览；左右方向键展开、收起或跳到父子节点；Enter 或空格切换分支。'}:{expand:'Expand',collapse:'Collapse',help:'Use arrow keys to browse; Right and Left expand, collapse, or move between parent and child. Enter or Space toggles a branch.'}}
function orgChartLabel(card:OrgChartCard):string{return card.description?card.label+' — '+card.description:card.label}
function focusOrgChart(host:HTMLElement|null,id:string):void{const card=Array.from(host?.querySelectorAll<HTMLElement>('[data-org-id]')??[]).find(element=>element.dataset.orgId===id);card?.focus({preventScroll:true});card?.scrollIntoView({block:'nearest',inline:'nearest'})}
function orgChartFocusSnapshot(host:HTMLElement|null):Element|null{const active=host?.ownerDocument.activeElement;return active&&host?.contains(active)?active:null}
function restoreOrgChartFocus(host:HTMLElement|null,previous:Element,id:string):void{
 if(!host)return
 const document=host.ownerDocument,active=document.activeElement,documentFallback=active===null||active===document.body||active===document.documentElement
 if(active===previous||host.contains(active)||(!previous.isConnected&&documentFallback))focusOrgChart(host,id)
}
function observeOrgChart(host:HTMLElement,measure:(width:number)=>void,localize:(language:string|undefined)=>void,lang?:string):()=>void{
 const resize=()=>measure(host.clientWidth),language=()=>localize(lang??host.closest('[lang]')?.getAttribute('lang')??undefined)
 resize();language()
 const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(resize);observer?.observe(host)
 const translation=typeof MutationObserver==='undefined'?undefined:new MutationObserver(language);translation?.observe(host.ownerDocument.documentElement,{attributes:true,attributeFilter:['lang'],subtree:true})
 window.addEventListener('resize',resize)
 return()=>{observer?.disconnect();translation?.disconnect();window.removeEventListener('resize',resize)}
}
function orgChartStyles(config:OpenPencilOrgChartConfig){return {background:config.backgroundColor,color:config.textColor,overflow:'auto','--org-card':config.cardColor,'--org-border':config.borderColor,'--org-muted':config.mutedColor,'--org-accent':config.accentColor,'--org-radius':config.borderRadius+'px','--org-font':config.fontSize+'px','--org-description-font':Math.max(10,config.fontSize-2)+'px'}}
function orgChartCardStyles(card:OrgChartCard){return {left:card.x+'px',top:card.y+'px',width:card.width+'px',height:card.height+'px'}}
`

export const ORG_CHART_STYLE_SOURCE = `[data-openpencil-org-chart]{box-sizing:border-box;min-width:0;max-width:100%;font:var(--org-font)/1.4 Inter,system-ui,sans-serif;direction:ltr;overscroll-behavior:contain}
[data-openpencil-org-chart] [data-org-surface]{position:relative;box-sizing:border-box;flex:none;min-height:1px}
[data-openpencil-org-chart] [data-org-connectors]{position:absolute;inset:0;pointer-events:none;overflow:visible}
[data-openpencil-org-chart] [data-org-id]{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-start;gap:4px;padding:12px;border:1px solid var(--org-border);border-radius:var(--org-radius);background:var(--org-card);color:inherit;outline:none;text-align:start}
[data-openpencil-org-chart] [data-org-copy]{display:flex;flex-direction:column;gap:4px;min-width:0}
[data-openpencil-org-chart] [data-org-id][aria-expanded] [data-org-copy]{padding-right:32px}
[data-openpencil-org-chart] [data-org-label]{font-weight:600;line-height:1.4;height:2.8em;flex:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
[data-openpencil-org-chart] [data-org-description]{font-size:var(--org-description-font);line-height:1.5;color:var(--org-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-openpencil-org-chart] [data-org-id]:focus-visible{outline:2px solid var(--org-accent);outline-offset:-3px}
[data-openpencil-org-chart] [data-org-toggle]{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:24px;height:24px;display:grid;place-items:center;padding:0;border:1px solid var(--org-border);border-radius:6px;background:var(--org-card);color:var(--org-accent);font:600 16px/1 system-ui,sans-serif;cursor:pointer}
[data-openpencil-org-chart] [data-org-toggle]:hover{border-color:var(--org-accent)}
[data-openpencil-org-chart] [data-org-toggle]:focus-visible{outline:2px solid var(--org-accent)}
[data-openpencil-org-chart] [data-org-help]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`
