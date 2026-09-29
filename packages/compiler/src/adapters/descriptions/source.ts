import { DESCRIPTIONS_LAYOUT } from '@open-pencil/core/plugins'

export const DESCRIPTIONS_CONFIG_SOURCE = `export interface OpenPencilDescriptionsConfig {
 label:string;items:readonly {id:string;label:string;value:string}[];columns:number;layout:'horizontal'|'vertical';bordered:boolean;density:'comfortable'|'compact';
 fontSize:number;borderRadius:number;backgroundColor:string;labelBackgroundColor:string;borderColor:string;labelColor:string;textColor:string
}
function descriptionsStyles(config:OpenPencilDescriptionsConfig){return {
 background:config.backgroundColor,borderRadius:config.borderRadius+'px',
 '--descriptions-columns':config.columns,'--descriptions-padding':(config.density==='compact'?${DESCRIPTIONS_LAYOUT.compactPadding}:${DESCRIPTIONS_LAYOUT.comfortablePadding})+'px',
 '--descriptions-font':config.fontSize+'px','--descriptions-label':config.labelColor,'--descriptions-text':config.textColor,
 '--descriptions-label-bg':config.labelBackgroundColor,'--descriptions-border':config.borderColor
}}
`
export const DESCRIPTIONS_STYLE_SOURCE = `
[data-openpencil-descriptions]{box-sizing:border-box;min-width:0;min-height:0;max-width:100%;overflow:auto;font:var(--descriptions-font)/${DESCRIPTIONS_LAYOUT.lineHeight} Inter,system-ui,sans-serif}
[data-openpencil-descriptions] dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,max(${DESCRIPTIONS_LAYOUT.minimumColumnWidth}px,100% / var(--descriptions-columns))),1fr));margin:0;padding:0;min-width:0}
[data-openpencil-descriptions] [data-description-item]{display:grid;grid-template-columns:${DESCRIPTIONS_LAYOUT.labelRatio * 100}% minmax(0,1fr);min-width:0;position:relative}
[data-openpencil-descriptions] dt,[data-openpencil-descriptions] dd{box-sizing:border-box;min-width:0;margin:0;padding:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
[data-openpencil-descriptions] dt{color:var(--descriptions-label)}
[data-openpencil-descriptions] dd{color:var(--descriptions-text)}
[data-openpencil-descriptions] [data-description-copy]{display:block;padding:min(var(--descriptions-padding),8cqw);min-width:0}
[data-openpencil-descriptions] [data-description-copy]:empty::before{content:'';display:block;height:${DESCRIPTIONS_LAYOUT.lineHeight}em}
[data-openpencil-descriptions] [data-description-item]{container-type:inline-size}
[data-openpencil-descriptions][data-layout=vertical] [data-description-item]{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr}
[data-openpencil-descriptions][data-bordered=true] dt{background:var(--descriptions-label-bg)}
[data-openpencil-descriptions][data-bordered=true] [data-description-item]::after{content:'';position:absolute;inset:0;box-shadow:inset 0 0 0 1px var(--descriptions-border);pointer-events:none}
[data-openpencil-descriptions][data-bordered=true] dt{box-shadow:inset -1px 0 var(--descriptions-border)}
[data-openpencil-descriptions][data-bordered=true][data-layout=vertical] dt{box-shadow:inset 0 -1px var(--descriptions-border)}
`
