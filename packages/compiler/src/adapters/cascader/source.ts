export const CASCADER_CONFIG_SOURCE = `interface CascaderItem{id:string;parentId:string;label:string;disabled:boolean}
export interface OpenPencilCascaderConfig{label:string;placeholder:string;items:readonly CascaderItem[];initialPath:readonly string[];searchable:boolean;clearable:boolean;disabled:boolean;backgroundColor:string;textColor:string;accentColor:string;borderColor:string;fontSize:number;rowHeight:number;borderRadius:number}
interface CascaderState{open:boolean;query:string;branch:string[];activeId:string}
interface CascaderRow{item:CascaderItem;path:string[];branch:boolean;disabled:boolean;level:number;position:number;size:number}
`

export const CASCADER_STATE_SOURCE = `function cascaderPath(config:OpenPencilCascaderConfig,value:unknown):string[]|null{
 if(!Array.isArray(value)||value.length>6||Object.getPrototypeOf(value)!==Array.prototype||Reflect.ownKeys(value).length!==value.length+1)return null
 const result:string[]=[];let parentId=''
 for(let index=0;index<value.length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor?.enumerable||!('value' in descriptor)||typeof descriptor.value!=='string')return null
  const item=config.items.find(candidate=>candidate.id===descriptor.value)
  if(!item||item.disabled||item.parentId!==parentId)return null
  result.push(item.id);parentId=item.id
 }
 return result.length&&config.items.some(item=>item.parentId===parentId)?null:result
}
function cascaderSummary(config:OpenPencilCascaderConfig,path:readonly string[]):string{return path.map(id=>config.items.find(item=>item.id===id)?.label??'').join(' / ')}
function cascaderInitial(path:readonly string[]):CascaderState{return {open:false,query:'',branch:path.slice(0,-1),activeId:path.at(-1)??''}}
function cascaderRow(config:OpenPencilCascaderConfig,item:CascaderItem):CascaderRow{
 const path:string[]=[];let current:CascaderItem|undefined=item,disabled=false
 while(current&&path.length<6){path.unshift(current.id);disabled||=current.disabled;current=config.items.find(parent=>parent.id===current?.parentId)}
 const siblings=config.items.filter(candidate=>candidate.parentId===item.parentId)
 return {item,path,disabled,branch:config.items.some(child=>child.parentId===item.id),level:path.length,position:siblings.findIndex(candidate=>candidate.id===item.id)+1,size:siblings.length}
}
function cascaderColumns(config:OpenPencilCascaderConfig,state:CascaderState):CascaderRow[][]{
 const query=state.query.trim().toLocaleLowerCase()
 if(query)return [config.items.map(item=>cascaderRow(config,item)).filter(row=>!row.branch&&cascaderSummary(config,row.path).toLocaleLowerCase().includes(query))]
 const columns:CascaderRow[][]=[];let parentId=''
 for(let level=0;level<6;level++){
  const rows=config.items.filter(item=>item.parentId===parentId).map(item=>cascaderRow(config,item));if(!rows.length)break
  columns.push(rows);const selected=rows.find(row=>row.item.id===state.branch[level]&&!row.disabled&&row.branch)
  if(!selected)break;parentId=selected.item.id
 }
 return columns
}
function cascaderActive(columns:CascaderRow[][],state:CascaderState):string{
 const rows=columns.flat();return rows.find(row=>row.item.id===state.activeId&&!row.disabled)?.item.id??rows.find(row=>!row.disabled)?.item.id??''
}
function cascaderNavigate(config:OpenPencilCascaderConfig,state:CascaderState,id:string):CascaderState{
 const row=cascaderColumns(config,state).flat().find(row=>row.item.id===id)
 return !row||row.disabled?state:{...state,branch:row.path.slice(0,row.branch?undefined:-1),activeId:id}
}
function cascaderKeyboard(config:OpenPencilCascaderConfig,state:CascaderState,key:string):{state:CascaderState;focus:string;choose:string;handled:boolean}{
 const columns=cascaderColumns(config,state),active=cascaderActive(columns,state),column=columns.find(rows=>rows.some(row=>row.item.id===active))??[],rows=column.filter(row=>!row.disabled),index=rows.findIndex(row=>row.item.id===active),row=rows[index]
 if(!row)return {state,focus:'',choose:'',handled:false}
 let next=state,focus=active,choose='',handled=true
 if(key==='ArrowDown')focus=rows[Math.min(rows.length-1,index+1)].item.id
 else if(key==='ArrowUp')focus=rows[Math.max(0,index-1)].item.id
 else if(key==='Home')focus=rows[0].item.id
 else if(key==='End')focus=rows[rows.length-1].item.id
 else if(key==='ArrowRight'&&row.branch&&!state.query.trim()){
  next=cascaderNavigate(config,state,active);focus=cascaderColumns(config,next).at(-1)?.find(candidate=>!candidate.disabled)?.item.id??active
 }else if(key==='ArrowLeft'&&!state.query.trim()&&row.path.length>1){focus=row.path.at(-2)??active;next={...state,branch:row.path.slice(0,-2)}}
 else if(key==='Enter'||key===' ')choose=active
 else handled=false
 return {state:{...next,activeId:focus},focus,choose,handled}
}
function cascaderFocus(host:HTMLElement|null,id:string):void{
 const row=Array.from(host?.querySelectorAll<HTMLElement>('[data-cascader-id]')??[]).find(element=>element.dataset.cascaderId===id)
 row?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest',inline:'nearest'})
}
function cascaderFocusRecovery(host:HTMLElement|null,trigger:()=>HTMLButtonElement|null){
 let last:HTMLElement|null=null
 const remember=(event:FocusEvent)=>{if(event.target instanceof HTMLElement)last=event.target}
 const leave=(event:FocusEvent)=>{if(event.relatedTarget instanceof Node&&!host?.contains(event.relatedTarget))last=null}
 host?.addEventListener('focusin',remember);host?.addEventListener('focusout',leave)
 return {restore:()=>{const button=trigger(),doc=host?.ownerDocument;if(last&&!last.isConnected&&host?.isConnected&&button&&!button.disabled&&(doc?.activeElement===doc?.body||doc?.activeElement===doc?.documentElement)){last=null;button.focus({preventScroll:true})}},destroy:()=>{last=null;host?.removeEventListener('focusin',remember);host?.removeEventListener('focusout',leave)}}
}
function cascaderCopy(zh:boolean){return zh?{search:'搜索完整路径',empty:'没有匹配选项',clear:'清除选择',invalid:'当前路径无效，请重新选择。'}:{search:'Search full paths',empty:'No matching options',clear:'Clear selection',invalid:'The current path is invalid. Choose a new value.'}}
function cascaderStyle(config:OpenPencilCascaderConfig){return {'--op-cascader-bg':config.backgroundColor,'--op-cascader-text':config.textColor,'--op-cascader-accent':config.accentColor,'--op-cascader-soft':config.accentColor+'18','--op-cascader-border':config.borderColor,'--op-cascader-font':config.fontSize+'px','--op-cascader-row':config.rowHeight+'px','--op-cascader-radius':config.borderRadius+'px'}}
`

export const CASCADER_STYLE_SOURCE = `[data-openpencil-cascader]{box-sizing:border-box;position:relative;min-width:0;max-width:100%;font-family:system-ui,sans-serif;line-height:1.5;font-size:var(--op-cascader-font);color:var(--op-cascader-text);overflow:visible!important}
[data-openpencil-cascader] *{box-sizing:border-box}
[data-openpencil-cascader] button,[data-openpencil-cascader] input{font:inherit;color:inherit}
[data-cascader-controls]{position:relative;display:flex;align-items:stretch;height:100%;min-height:44px;border:1px solid var(--op-cascader-border);border-radius:var(--op-cascader-radius);background:var(--op-cascader-bg)}
[data-cascader-controls][data-disabled=true]{opacity:.5}
[data-cascader-trigger]{min-width:0;width:100%;display:flex;align-items:center;gap:12px;text-align:start;border:0;border-radius:inherit;background:transparent;padding:0 12px;min-height:42px;cursor:pointer}
[data-cascader-summary]{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-cascader-summary][data-empty=true]{opacity:.6}
[data-cascader-trigger][data-clear=true]{padding-inline-end:60px}
[data-cascader-arrow]{flex:0 0 14px;text-align:center;font-size:14px;opacity:.65}
[data-cascader-trigger][data-clear=true] [data-cascader-arrow]{position:absolute;right:12px}
[data-cascader-clear]{position:absolute;inset-block:0;right:32px;width:36px;border:0;background:transparent;padding:0;opacity:.65;cursor:pointer}
[data-cascader-panel]{position:absolute;inset-inline-start:0;top:calc(100% + 4px);z-index:30;width:100%;min-width:0;max-width:100%;padding:6px;border:1px solid var(--op-cascader-border);border-radius:var(--op-cascader-radius);background:var(--op-cascader-bg);box-shadow:0 8px 24px #0002}
[data-cascader-search]{width:100%;min-width:0;border:1px solid var(--op-cascader-border);border-radius:5px;background:var(--op-cascader-bg);padding:8px;margin:0 0 6px}
[data-cascader-columns]{display:flex;overflow-x:auto;max-width:100%;scrollbar-width:thin;overscroll-behavior:contain}
[data-cascader-column]{flex:0 0 max(140px,50%);min-width:0;max-height:256px;overflow-y:auto;border-inline-end:1px solid var(--op-cascader-border);padding:0 4px}
[data-cascader-column]:last-child{border:0}
[data-cascader-columns][data-search=true] [data-cascader-column]{flex-basis:100%}
[data-cascader-item]{display:flex;align-items:center;gap:8px;min-width:0;min-height:var(--op-cascader-row);padding:4px 8px;border-radius:5px;cursor:pointer;outline-offset:-2px}
[data-cascader-item] span:first-child{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-cascader-item][aria-selected=true],[data-cascader-item][aria-expanded=true]{background:var(--op-cascader-soft);color:var(--op-cascader-accent)}
[data-cascader-item][aria-disabled=true]{opacity:.5;cursor:default}
[data-openpencil-cascader] button:disabled{cursor:default}
[data-cascader-item]:focus-visible,[data-openpencil-cascader] button:focus-visible,[data-cascader-search]:focus-visible{outline:2px solid var(--op-cascader-accent);outline-offset:-2px}
[data-cascader-empty]{margin:0;padding:8px;font-size:.9em;overflow-wrap:anywhere}
`
