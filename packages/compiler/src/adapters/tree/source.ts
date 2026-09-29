export const TREE_CONFIG_SOURCE = `interface TreeItem {id:string;label:string;parentId:string;disabled:boolean}
export interface OpenPencilTreeConfig {presentation:'tree'|'select';label:string;placeholder:string;items:readonly TreeItem[];selectionMode:'single'|'multiple';initialSelectedIds:readonly string[];initialExpandedIds:readonly string[];searchable:boolean;disabled:boolean;showValue:boolean;backgroundColor:string;textColor:string;accentColor:string;borderColor:string;fontSize:number;rowHeight:number}
interface TreeState {selected:string[];expanded:string[];query:string;activeId:string;open:boolean}
interface TreeRow {item:TreeItem;level:number;disabled:boolean;hasChildren:boolean;expanded:boolean;position:number;size:number}
`
export const TREE_STYLE_SOURCE = `[data-openpencil-tree]{box-sizing:border-box;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:8px;padding:12px;font-family:system-ui,sans-serif;line-height:1.4;overflow:auto;background:var(--op-tree-bg);color:var(--op-tree-text);font-size:var(--op-tree-font)}
[data-openpencil-tree] *{box-sizing:border-box}
[data-openpencil-tree] button,[data-openpencil-tree] input{font:inherit;color:inherit}
[data-tree-label]{font-weight:600;overflow-wrap:anywhere}
[data-tree-panel]{min-height:0;display:flex;flex-direction:column;gap:6px;border:1px solid var(--op-tree-border);border-radius:8px;padding:6px;background:var(--op-tree-bg)}
[data-tree-search]{width:100%;min-width:0;border:1px solid var(--op-tree-border);border-radius:6px;padding:8px;background:var(--op-tree-bg)}
[data-tree-list]{overflow:auto;min-height:44px;max-height:256px;outline:none}
[data-tree-row]{display:flex;align-items:center;min-height:var(--op-tree-row);gap:6px;padding-block:4px;padding-inline-end:6px;border-radius:5px;min-width:0;cursor:pointer;outline-offset:-2px}
[data-tree-row][aria-selected=true]{background:var(--op-tree-soft);color:var(--op-tree-accent)}
[data-tree-row][aria-disabled=true]{opacity:.5;cursor:default}
[data-tree-row]:focus-visible,[data-openpencil-tree] button:focus-visible,[data-tree-search]:focus-visible{outline:2px solid var(--op-tree-accent);outline-offset:-2px}
[data-tree-expander]{width:24px;height:28px;flex:0 0 24px;border:0;background:transparent;border-radius:4px;padding:0;cursor:pointer}
[data-tree-expander][disabled]{cursor:default}
[data-tree-spacer]{width:24px;flex:0 0 24px}
[data-tree-item-label]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
[data-tree-check]{width:16px;height:16px;flex:0 0 16px;border:1px solid currentColor;border-radius:3px;display:grid;place-items:center;font-size:12px;line-height:1}
[data-tree-controls]{display:flex;gap:4px;min-width:0}
[data-tree-trigger]{display:flex;align-items:center;gap:8px;min-width:0;flex:1;min-height:44px;padding:8px 12px;text-align:start;border:1px solid var(--op-tree-border);border-radius:8px;background:var(--op-tree-bg)}
[data-tree-summary]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
[data-tree-clear]{flex:0 0 36px;border:1px solid var(--op-tree-border);border-radius:6px;background:transparent}
[data-openpencil-tree] button:disabled{opacity:.5;cursor:default}
[data-tree-output],[data-tree-empty]{font-size:.85em;overflow-wrap:anywhere;line-height:1.4;margin:0;padding:4px}
[data-tree-output]{opacity:.75}
`
export const TREE_STATE_SOURCE = `function treeKey(config:OpenPencilTreeConfig):string{return JSON.stringify([config.items,config.selectionMode,config.initialSelectedIds,config.initialExpandedIds,config.presentation,config.searchable])}
function initialTree(config:OpenPencilTreeConfig):TreeState{return {selected:[...config.initialSelectedIds],expanded:[...config.initialExpandedIds],query:'',activeId:'',open:false}}
function treeCopy(language:string){return language.toLowerCase().startsWith('zh')?{search:'搜索树节点',empty:'没有匹配节点',none:'未选择',selected:'已选',clear:'清除选择',expand:'展开',collapse:'收起'}:{search:'Search tree items',empty:'No matching items',none:'None selected',selected:'Selected',clear:'Clear selection',expand:'Expand',collapse:'Collapse'}}
function visibleRows(config:OpenPencilTreeConfig,state:TreeState):TreeRow[]{
 const needle=state.query.trim().toLocaleLowerCase(),matches=new Set<string>(),byId=new Map(config.items.map(item=>[item.id,item]))
 if(needle)for(const item of config.items){if(!item.label.toLocaleLowerCase().includes(needle))continue;let current:TreeItem|undefined=item;while(current&&!matches.has(current.id)){matches.add(current.id);current=byId.get(current.parentId)}}
 const rows:TreeRow[]=[]
 function visit(parentId:string,level:number,disabled:boolean):void{
  const siblings=config.items.filter(item=>item.parentId===parentId&&(!needle||matches.has(item.id)))
  siblings.forEach((item,index)=>{const hasChildren=config.items.some(child=>child.parentId===item.id),expanded=hasChildren&&(Boolean(needle)||state.expanded.includes(item.id)),inactive=disabled||config.disabled||item.disabled;rows.push({item,level,disabled:inactive,hasChildren,expanded,position:index+1,size:siblings.length});if(expanded)visit(item.id,level+1,inactive)})
 }
 visit('',1,false);return rows
}
function treeSummary(config:OpenPencilTreeConfig,state:TreeState):string{return state.selected.map(id=>config.items.find(item=>item.id===id)?.label??id).join(', ')}
function toggleBranch(config:OpenPencilTreeConfig,state:TreeState,id:string):TreeState{
 const row=visibleRows(config,state).find(row=>row.item.id===id)
 if(!row||row.disabled||!row.hasChildren||state.query.trim())return state
 return {...state,activeId:id,expanded:state.expanded.includes(id)?state.expanded.filter(value=>value!==id):[...state.expanded,id]}
}
function chooseTree(config:OpenPencilTreeConfig,state:TreeState,id:string):TreeState{
 const row=visibleRows(config,state).find(row=>row.item.id===id)
 if(!row||row.disabled)return state
 const selected=config.selectionMode==='single'?[id]:state.selected.includes(id)?state.selected.filter(value=>value!==id):[...state.selected,id]
 return {...state,activeId:id,selected,open:config.presentation==='select'&&config.selectionMode==='single'?false:state.open}
}
function treeKeyboard(config:OpenPencilTreeConfig,state:TreeState,key:string):{state:TreeState;handled:boolean;focus:string}{
 if(config.disabled)return {state,handled:false,focus:''}
 const rows=visibleRows(config,state).filter(row=>!row.disabled),index=Math.max(0,rows.findIndex(row=>row.item.id===state.activeId)),row=rows[index]
 if(!row)return {state,handled:false,focus:''}
 let next=state,focus=row.item.id,handled=true
 if(key==='ArrowDown')focus=rows[Math.min(rows.length-1,index+1)].item.id
 else if(key==='ArrowUp')focus=rows[Math.max(0,index-1)].item.id
 else if(key==='Home')focus=rows[0].item.id
 else if(key==='End')focus=rows[rows.length-1].item.id
 else if(key==='ArrowRight'){if(row.hasChildren&&!row.expanded)next=toggleBranch(config,state,row.item.id);else if(row.hasChildren&&rows[index+1]?.item.parentId===row.item.id)focus=rows[index+1].item.id}
 else if(key==='ArrowLeft'){if(row.hasChildren&&row.expanded&&!state.query.trim())next=toggleBranch(config,state,row.item.id);else if(row.item.parentId&&rows.some(candidate=>candidate.item.id===row.item.parentId))focus=row.item.parentId}
 else if(key===' '||key==='Enter')next=chooseTree(config,state,row.item.id)
 else handled=false
 return {state:{...next,activeId:focus},handled,focus:handled?focus:''}
}
function activeTreeId(rows:TreeRow[],state:TreeState):string{return rows.find(row=>row.item.id===state.activeId&&!row.disabled)?.item.id??rows.find(row=>!row.disabled)?.item.id??''}
function focusTreeRow(host:HTMLElement|null,id:string):void{host?.querySelector<HTMLElement>('[data-tree-id="'+id+'"]')?.focus()}
`
