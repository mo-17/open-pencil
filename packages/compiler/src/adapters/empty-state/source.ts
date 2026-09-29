import { EMPTY_STATE_ILLUSTRATION_PATHS, EMPTY_STATE_LAYOUT } from '@open-pencil/core/plugins'

export const EMPTY_STATE_CONFIG_SOURCE = `export interface OpenPencilEmptyStateConfig {
  title:string;description:string;illustration:'box'|'search'|'none';alignment:'center'|'left';
  iconSize:number;fontSize:number;gap:number;padding:number;borderRadius:number;
  backgroundColor:string;textColor:string;descriptionColor:string;illustrationColor:string
}
const emptyIllustrations=${JSON.stringify(EMPTY_STATE_ILLUSTRATION_PATHS)}
function emptyStateStyles(config:OpenPencilEmptyStateConfig){return {
  background:config.backgroundColor,borderRadius:config.borderRadius+'px',
  '--empty-title':config.textColor,'--empty-description':config.descriptionColor,'--empty-illustration':config.illustrationColor,
  '--empty-font':config.fontSize+'px','--empty-icon':config.iconSize+'px','--empty-gap':config.gap+'px','--empty-padding':config.padding+'px'
}}
`

export const EMPTY_STATE_STYLE_SOURCE = `
[data-openpencil-empty-state]{box-sizing:border-box;min-width:0;min-height:0;max-width:100%;overflow:auto}
[data-openpencil-empty-state] [data-empty-body]{box-sizing:border-box;min-height:100%;padding:min(var(--empty-padding),${EMPTY_STATE_LAYOUT.maximumInsetRatio * 100}%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--empty-gap);text-align:center;font:var(--empty-font)/${EMPTY_STATE_LAYOUT.lineHeight} Inter,system-ui,sans-serif}
[data-openpencil-empty-state][data-alignment=left] [data-empty-body]{align-items:flex-start;text-align:left}
[data-openpencil-empty-state] [data-empty-illustration]{display:block;flex:none;width:min(var(--empty-icon),100%);height:auto;aspect-ratio:1;color:var(--empty-illustration)}
[data-openpencil-empty-state] [data-empty-title],[data-openpencil-empty-state] [data-empty-description]{flex:none;min-width:0;width:100%;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
[data-openpencil-empty-state] [data-empty-title]{font-size:${EMPTY_STATE_LAYOUT.titleScale}em;font-weight:600;line-height:${EMPTY_STATE_LAYOUT.lineHeight};color:var(--empty-title)}
[data-openpencil-empty-state] [data-empty-description]{color:var(--empty-description)}
`

export const EMPTY_STATE_SVG_METRICS = EMPTY_STATE_LAYOUT
