export const SKELETON_CONFIG_SOURCE = `export interface OpenPencilSkeletonConfig {
 variant:'text'|'rectangle'|'circle'; rows:number; lineHeight:number; gap:number; lastLineWidth:number;
 color:string; backgroundColor:string; textColor:string; borderRadius:number;
 animation:'none'|'pulse'; label:string; showLabel:boolean; fontSize:number
}`
export const SKELETON_PRESENTATION_SOURCE = `function skeletonPresentation(config:OpenPencilSkeletonConfig){
 const naturalHeight=config.rows*config.lineHeight+(config.rows-1)*config.gap
 return {rows:Array.from({length:config.rows},(_,index)=>index),styles:{
  background:config.backgroundColor,color:config.textColor,'--skeleton-color':config.color,
  '--skeleton-radius':config.borderRadius+'px','--skeleton-rows':String(config.rows),
  '--skeleton-height':naturalHeight+'px','--skeleton-gap':config.gap/naturalHeight*100+'%',
  '--skeleton-last':config.lastLineWidth+'%','--skeleton-font':config.fontSize+'px'}}
}`
export const SKELETON_STYLE_SOURCE = `
[data-openpencil-skeleton]{box-sizing:border-box;display:grid;grid-template-columns:min(16px,5%) minmax(0,1fr) min(16px,5%);grid-template-rows:min(16px,20%) minmax(0,1fr) min(16px,20%);min-width:0;max-width:100%;overflow:hidden}
[data-openpencil-skeleton] [data-skeleton-content]{grid-area:2/2;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
[data-openpencil-skeleton] [data-skeleton-label]{display:block;flex-shrink:0;font-size:var(--skeleton-font);line-height:1.5;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin-bottom:12px}
[data-openpencil-skeleton] [data-skeleton-label][data-hidden="true"]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
[data-openpencil-skeleton] [data-skeleton-shapes]{flex:1;min-width:0;min-height:0;overflow:hidden}
[data-openpencil-skeleton] [data-skeleton-lines]{display:grid;grid-template-rows:repeat(var(--skeleton-rows),minmax(0,1fr));row-gap:var(--skeleton-gap);height:min(100%,var(--skeleton-height));width:100%}
[data-openpencil-skeleton] [data-skeleton-line],[data-openpencil-skeleton] [data-skeleton-rectangle]{display:block;background:var(--skeleton-color);border-radius:var(--skeleton-radius);min-width:0;min-height:0}
[data-openpencil-skeleton] [data-skeleton-line]:last-child{width:var(--skeleton-last)}
[data-openpencil-skeleton] [data-skeleton-rectangle]{width:100%;height:100%}
[data-openpencil-skeleton] [data-skeleton-circle]{display:block;width:100%;height:100%;fill:var(--skeleton-color)}
[data-openpencil-skeleton][data-animation="pulse"] [data-skeleton-shapes]{animation:op-skeleton-pulse 1.8s ease-in-out infinite}
@keyframes op-skeleton-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@media(prefers-reduced-motion:reduce){[data-openpencil-skeleton] [data-skeleton-shapes]{animation:none!important;opacity:1!important}}
`
