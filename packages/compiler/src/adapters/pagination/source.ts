import { PAGINATION_LAYOUT } from '@open-pencil/core/plugins'

export const PAGINATION_CONFIG_SOURCE = `export interface OpenPencilPaginationConfig {
 label:string;total:number;pageSize:number;initialPage:number;showFirstLast:boolean;disabled:boolean;size:'comfortable'|'compact';
 backgroundColor:string;textColor:string;accentColor:string;borderColor:string;borderRadius:number;fontSize:number
}
export interface PaginationInputs {currentPage?:unknown;currentPageBound?:boolean;total?:unknown;totalBound?:boolean;pageSize?:unknown;pageSizeBound?:boolean}
type PaginationItem=number|'ellipsis-start'|'ellipsis-end'
type PaginationCellKind='page'|'ellipsis'|'first'|'previous'|'next'|'last'|'summary'
interface PaginationCell {key:string;kind:PaginationCellKind;text:string;page:number|null;active:boolean;disabled:boolean;x:number;width:number}
interface PaginationLayout {mode:'full'|'compact'|'summary';page:number;pageCount:number;buttonSize:number;gap:number;fontSize:number;width:number;cells:PaginationCell[]}
const PAGINATION_LAYOUT=${JSON.stringify(PAGINATION_LAYOUT)}
`

/** Typed generated source is compared against the Core projection in regression tests.
 * Function.toString is deliberately avoided: production minification renames closures. */
export const PAGINATION_MATH_SOURCE = `
function paginationPageCount(total:number,pageSize:number):number {return Math.max(0,Math.ceil(total/pageSize))}
function clampPaginationPage(page:number,count:number):number {return count===0?0:Math.max(1,Math.min(count,Math.floor(Number.isFinite(page)?page:1)))}
function paginationItems(page:number,pageCount:number,compact=false):PaginationItem[] {
 const current=clampPaginationPage(page,pageCount),limit=compact?5:7
 if(pageCount<=limit)return Array.from({length:pageCount},(_,index)=>index+1)
 const edge=compact?3:5
 if(current<=edge-1||(compact&&current===3))return [...Array.from({length:edge},(_,index)=>index+1),'ellipsis-end',pageCount]
 if(current>=pageCount-edge+2||(compact&&current===pageCount-2))return [1,'ellipsis-start',...Array.from({length:edge},(_,index)=>pageCount-edge+1+index)]
 return compact?[1,'ellipsis-start',current,'ellipsis-end',pageCount]:[1,'ellipsis-start',current-1,current,current+1,'ellipsis-end',pageCount]
}
function paginationLayout(width:number,config:OpenPencilPaginationConfig,requestedPage=config.initialPage):PaginationLayout {
 const available=Math.max(0,Number.isFinite(width)?width:0),pageCount=paginationPageCount(config.total,config.pageSize),page=clampPaginationPage(requestedPage,pageCount)
 let buttonSize:number=PAGINATION_LAYOUT[config.size],fontSize=config.fontSize
 const gap=Math.min(PAGINATION_LAYOUT.gap,available/4),cells:PaginationCell[]=[]
 const textWidth=(text:string)=>Math.max(buttonSize,Math.ceil(text.length*fontSize*PAGINATION_LAYOUT.digitWidth+PAGINATION_LAYOUT.horizontalPadding))
 const navCount=config.showFirstLast?4:2
 const measure=(items:PaginationItem[])=>items.reduce<number>((sum,item)=>sum+textWidth(typeof item==='number'?String(item):'…'),0)+navCount*buttonSize+Math.max(0,items.length+navCount-1)*gap
 let mode:PaginationLayout['mode']=config.size==='compact'?'compact':'full',items=paginationItems(page,pageCount,mode==='compact')
 if(measure(items)>available){mode='compact';items=paginationItems(page,pageCount,true)}
 if(pageCount===0||measure(items)>available)mode='summary'
 let firstLast=config.showFirstLast,summaryWidth=0,navigationWidth:number=buttonSize,summaryText=page+' / '+pageCount
 if(mode==='summary'){
  const minimumText=summaryText.length*10*PAGINATION_LAYOUT.digitWidth+PAGINATION_LAYOUT.horizontalPadding
  if(firstLast&&available<buttonSize*4+gap*4+minimumText)firstLast=false
  const navigation=firstLast?4:2
  if(available<minimumText+navigation*(24+gap))summaryText=page+'\\n/ '+pageCount
  const longestLine=Math.max(...summaryText.split('\\n').map(line=>line.length))
  const minimumSummary=longestLine*10*PAGINATION_LAYOUT.digitWidth+PAGINATION_LAYOUT.horizontalPadding
  const reservedText=Math.min(minimumSummary,Math.max(0,available-navigation*(Math.min(24,available/(navigation+1))+gap)))
  navigationWidth=Math.min(buttonSize,Math.max(0,(available-reservedText-gap*navigation)/navigation))
  summaryWidth=Math.max(0,available-navigation*(navigationWidth+gap))
  fontSize=Math.min(fontSize,buttonSize/(summaryText.includes('\\n')?3:1.5),Math.max(10,(summaryWidth-PAGINATION_LAYOUT.horizontalPadding)/(longestLine*PAGINATION_LAYOUT.digitWidth)))
 }
 const append=(kind:PaginationCellKind,text:string,target:number|null,cellWidth:number,key:string=kind)=>{
  const boundary=(kind==='previous'||kind==='first')?page<=1:(kind==='next'||kind==='last')&&page>=pageCount
  cells.push({key,kind,text,page:target,active:kind==='page'&&target===page,disabled:config.disabled||pageCount===0||boundary||(kind==='page'&&target===page),x:0,width:cellWidth})
 }
 if(firstLast)append('first','',1,navigationWidth)
 append('previous','',Math.max(1,page-1),navigationWidth)
 if(mode==='summary')append('summary',summaryText,null,summaryWidth)
 else for(const item of items){if(typeof item==='number')append('page',String(item),item,textWidth(String(item)),'page-'+item);else append('ellipsis','…',null,buttonSize,item)}
 append('next','',Math.min(pageCount,page+1),navigationWidth)
 if(firstLast)append('last','',pageCount,navigationWidth)
 let x=0;for(const cell of cells){cell.x=x;x+=cell.width+gap}
 return {mode,page,pageCount,buttonSize,gap,fontSize,width:Math.max(0,x-gap),cells}
}
function paginationInteger(value:unknown,min:number,max:number):value is number {return typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max}
function paginationProjection(config:OpenPencilPaginationConfig,inputs:PaginationInputs,localPage:number,width:number){
 const total=inputs.totalBound?inputs.total:config.total,size=inputs.pageSizeBound?inputs.pageSize:config.pageSize,current=inputs.currentPageBound?inputs.currentPage:localPage
 const valid=paginationInteger(total,0,1000000000)&&paginationInteger(size,1,1000)&&paginationInteger(current,1,1000000000)
 const projected={...config,total:valid?total:0,pageSize:valid?size:1,disabled:config.disabled||!valid}
 const layout=paginationLayout(width,projected,valid?current:1)
 return {...layout,invalid:!valid,disabled:projected.disabled,empty:valid&&total===0,clamped:valid&&layout.page>0&&layout.page!==current}
}
function paginationChinese(lang:string|undefined):boolean{return typeof lang==='string'&&/^zh(?:-|$)/i.test(lang)}
function paginationCellLabel(cell:PaginationCell,zh:boolean):string {
 const labels=zh?{first:'第一页',previous:'上一页',next:'下一页',last:'最后一页'}:{first:'First page',previous:'Previous page',next:'Next page',last:'Last page'}
 if(cell.kind==='page')return zh?'第 '+cell.text+' 页':'Page '+cell.text
 if(cell.kind==='first'||cell.kind==='previous'||cell.kind==='next'||cell.kind==='last')return labels[cell.kind]
 return cell.text
}
function paginationStatus(layout:ReturnType<typeof paginationProjection>,zh:boolean):string{
 if(layout.invalid)return zh?'分页数据不可用，请检查数值绑定':'Pagination data unavailable; check numeric bindings'
 if(layout.empty)return zh?'暂无数据':'No items'
 if(layout.clamped)return zh?'当前页超出范围，正在显示最近的有效页':'Requested page is out of range; showing the nearest available page'
 return zh?'第 '+layout.page+' 页，共 '+layout.pageCount+' 页':'Page '+layout.page+' of '+layout.pageCount
}
function paginationArrow(kind:PaginationCellKind):string{return kind==='first'?'«':kind==='previous'?'‹':kind==='last'?'»':'›'}
function paginationStyles(config:OpenPencilPaginationConfig){return {background:config.backgroundColor,color:config.textColor,
 '--pagination-accent':config.accentColor,'--pagination-border':config.borderColor,'--pagination-radius':config.borderRadius+'px','--pagination-font':config.fontSize+'px'}}
`

export const PAGINATION_STYLE_SOURCE = `[data-openpencil-pagination]{box-sizing:border-box;min-width:0;max-width:100%;overflow:hidden;display:flex;align-items:center;font:var(--pagination-font)/1.2 Inter,system-ui,sans-serif;direction:ltr}
[data-openpencil-pagination] [data-pagination-items]{display:flex;align-items:center;max-width:100%;flex:none;gap:4px;min-width:0}
[data-openpencil-pagination] [data-pagination-cell]{box-sizing:border-box;flex:none;min-width:0;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;text-align:center;overflow:hidden;line-height:1.2}
[data-openpencil-pagination] button{appearance:none;margin:0;padding:0 4px;border:1px solid var(--pagination-border);border-radius:var(--pagination-radius);color:inherit;background:transparent;cursor:pointer;font:inherit;transition:background .12s,border-color .12s}
[data-openpencil-pagination] button:not(:disabled):hover{border-color:var(--pagination-accent);color:var(--pagination-accent)}
[data-openpencil-pagination] button[aria-current=page]{background:var(--pagination-accent);border-color:var(--pagination-accent);color:white;opacity:1}
[data-openpencil-pagination] button:disabled:not([aria-current=page]){opacity:.4;cursor:default}
[data-openpencil-pagination][data-disabled=true] [data-pagination-cell]{opacity:.45}
[data-openpencil-pagination] button:focus-visible{outline:2px solid var(--pagination-accent);outline-offset:-3px}
[data-openpencil-pagination] [data-pagination-arrow]{font-family:Arial,sans-serif;font-size:24px;line-height:1}
[data-openpencil-pagination] [data-pagination-summary]{white-space:pre-line}
[data-openpencil-pagination] [data-pagination-status]{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
[data-openpencil-pagination][data-invalid=true] [data-pagination-summary]{color:inherit}
`
