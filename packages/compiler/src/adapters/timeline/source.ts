import { TIMELINE_LAYOUT, TIMELINE_MARK_PATHS } from '@open-pencil/core/plugins'

export const TIMELINE_CONFIG_SOURCE = `export interface OpenPencilTimelineConfig {
  label:string
  items:readonly {id:string;title:string;description:string;time:string;status:'completed'|'current'|'pending'|'error'}[]
  layout:'start'|'alternate'
  emptyText:string
  backgroundColor:string
  textColor:string
  accentColor:string
  completedColor:string
  errorColor:string
  lineColor:string
  fontSize:number
  itemGap:number
  markerSize:number
  lineWidth:number
}
const timelinePaths=${JSON.stringify(TIMELINE_MARK_PATHS)}
function timelineStatusLabels(lang?:string){
 const chinese=(lang??(typeof document==='undefined'?'en':document.documentElement.lang)).toLowerCase().startsWith('zh')
 return chinese?{completed:'已完成',current:'当前',pending:'待处理',error:'错误'}:{completed:'Completed',current:'Current',pending:'Pending',error:'Error'}
}
function timelineStyles(config:OpenPencilTimelineConfig){return {
  background:config.backgroundColor,color:config.textColor,
  '--timeline-font':config.fontSize+'px','--timeline-gap':config.itemGap+'px',
  '--timeline-marker':config.markerSize+'px','--timeline-line-width':config.lineWidth+'px',
  '--timeline-line':config.lineColor,'--timeline-accent':config.accentColor,
  '--timeline-completed':config.completedColor,'--timeline-error':config.errorColor,
  '--timeline-background':config.backgroundColor,'--timeline-muted':config.textColor+'BF'
}}
`

export const TIMELINE_STYLE_SOURCE = `
[data-openpencil-timeline]{box-sizing:border-box;min-width:0;max-width:100%;overflow:auto;container-type:inline-size;font-size:var(--timeline-font);line-height:${TIMELINE_LAYOUT.lineHeight}}
[data-openpencil-timeline] [data-timeline-list]{list-style:none;margin:0;padding:${TIMELINE_LAYOUT.inset}px;box-sizing:border-box}
[data-openpencil-timeline] [data-timeline-list]:empty{padding:0}
[data-openpencil-timeline] [data-timeline-item]{position:relative;display:grid;grid-template-columns:var(--timeline-marker) minmax(0,1fr);column-gap:${TIMELINE_LAYOUT.columnGap}px;padding:0 0 var(--timeline-gap);min-height:max(var(--timeline-marker),calc(var(--timeline-font)*${TIMELINE_LAYOUT.lineHeight}));box-sizing:content-box}
[data-openpencil-timeline] [data-timeline-item]:last-child{padding-bottom:0}
[data-openpencil-timeline] [data-timeline-marker]{position:relative;grid-column:1;grid-row:1;width:var(--timeline-marker);height:var(--timeline-marker);margin-top:max(0px,calc((var(--timeline-font)*${TIMELINE_LAYOUT.lineHeight} - var(--timeline-marker))/2));color:var(--timeline-accent);flex-shrink:0;z-index:1}
[data-openpencil-timeline] [data-timeline-marker] svg{display:block;width:100%;height:100%;overflow:visible}
[data-openpencil-timeline] [data-status="completed"] [data-timeline-marker]{color:var(--timeline-completed)}
[data-openpencil-timeline] [data-status="error"] [data-timeline-marker]{color:var(--timeline-error)}
[data-openpencil-timeline] [data-status="pending"] [data-timeline-marker]{color:var(--timeline-line)}
[data-openpencil-timeline] [data-timeline-item]:not(:last-child)::before{content:'';position:absolute;left:calc((var(--timeline-marker) - var(--timeline-line-width))/2);top:calc(max(var(--timeline-marker),var(--timeline-font)*${TIMELINE_LAYOUT.lineHeight})/2 + var(--timeline-marker)/2 + 4px);bottom:calc(-1 * max(0px,(var(--timeline-font)*${TIMELINE_LAYOUT.lineHeight} - var(--timeline-marker))/2) + 4px);width:var(--timeline-line-width);background:var(--timeline-line)}
[data-openpencil-timeline] [data-timeline-content]{grid-column:2;grid-row:1;min-width:0;display:flex;flex-direction:column;gap:${TIMELINE_LAYOUT.textGap}px;overflow-wrap:anywhere;white-space:pre-wrap}
[data-openpencil-timeline] [data-timeline-title]{font-weight:600}
[data-openpencil-timeline] [data-timeline-description],[data-openpencil-timeline] [data-timeline-time]{font-size:${TIMELINE_LAYOUT.secondaryScale}em;color:var(--timeline-muted)}
[data-openpencil-timeline] [data-timeline-empty]{margin:0;padding:${TIMELINE_LAYOUT.inset}px;color:var(--timeline-muted);overflow-wrap:anywhere;white-space:pre-wrap}
@container(min-width:${TIMELINE_LAYOUT.alternateMinWidth}px){
 [data-openpencil-timeline][data-layout="alternate"] [data-timeline-item]{grid-template-columns:minmax(0,1fr) var(--timeline-marker) minmax(0,1fr)}
 [data-openpencil-timeline][data-layout="alternate"] [data-timeline-marker]{grid-column:2}
 [data-openpencil-timeline][data-layout="alternate"] [data-timeline-content]{grid-column:3}
 [data-openpencil-timeline][data-layout="alternate"] [data-timeline-item]:nth-child(even) [data-timeline-content]{grid-column:1;text-align:right}
 [data-openpencil-timeline][data-layout="alternate"] [data-timeline-item]:not(:last-child)::before{left:calc((100% - var(--timeline-line-width))/2)}
}
`
