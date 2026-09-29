import { FLOATING_POSITION_SOURCE } from '../floating/position'

export const TOOLTIP_CONFIG_SOURCE = `export interface OpenPencilTooltipConfig {
 triggerLabel:string;content:string;placement:'top'|'right'|'bottom'|'left';gap:number;maxWidth:number;
 backgroundColor:string;textColor:string;triggerBackground:string;triggerTextColor:string;
 borderRadius:number;fontSize:number;openDelay:number;closeDelay:number
}`
export const TOOLTIP_STYLE_SOURCE = `[data-openpencil-tooltip]{min-width:0;isolation:isolate;overflow:visible!important}
[data-tooltip-trigger]{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:100%;min-height:24px;padding:0 12px;border:0;background:var(--tooltip-trigger-bg);color:var(--tooltip-trigger-fg);border-radius:var(--tooltip-radius);font-family:inherit;font-size:var(--tooltip-font);font-weight:400;line-height:1.5;cursor:help;overflow:hidden;overflow-wrap:anywhere;white-space:normal}
[data-tooltip-trigger]:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
[data-tooltip-bubble]{box-sizing:border-box;inset:auto;margin:0;border:0;padding:10px 12px;width:max-content;background:var(--tooltip-bg);color:var(--tooltip-fg);border-radius:var(--tooltip-radius);font:400 var(--tooltip-font)/1.5 sans-serif;overflow:visible;z-index:1000;box-shadow:0 4px 14px #0003;overflow-wrap:anywhere;white-space:pre-wrap}
[data-tooltip-bubble][hidden]{display:none!important}
[data-tooltip-text]{display:block;max-height:calc(100dvh - 36px);overflow:auto}
[data-tooltip-bubble]::before{content:"";position:absolute;pointer-events:auto}
[data-tooltip-side=top]::before{top:100%;left:0;width:100%;height:calc(var(--tooltip-gap) + 2px)}
[data-tooltip-side=bottom]::before{bottom:100%;left:0;width:100%;height:calc(var(--tooltip-gap) + 2px)}
[data-tooltip-side=left]::before{left:100%;top:0;height:100%;width:calc(var(--tooltip-gap) + 2px)}
[data-tooltip-side=right]::before{right:100%;top:0;height:100%;width:calc(var(--tooltip-gap) + 2px)}
@media(forced-colors:active){[data-tooltip-trigger],[data-tooltip-bubble]{border:1px solid CanvasText}}
`
export const TOOLTIP_VISUAL_SOURCE = `function tooltipStyle(config:OpenPencilTooltipConfig){return {
 '--tooltip-trigger-bg':config.triggerBackground,'--tooltip-trigger-fg':config.triggerTextColor,
 '--tooltip-bg':config.backgroundColor,'--tooltip-fg':config.textColor,
 '--tooltip-radius':config.borderRadius+'px','--tooltip-font':config.fontSize+'px','--tooltip-gap':config.gap+'px'
}}
function tooltipConfigKey(config:OpenPencilTooltipConfig){return JSON.stringify([config.triggerLabel,config.content,config.placement,config.gap,config.maxWidth,config.backgroundColor,config.textColor,config.triggerBackground,config.triggerTextColor,config.borderRadius,config.fontSize,config.openDelay,config.closeDelay])}`
export const TOOLTIP_POSITION_SOURCE =
  FLOATING_POSITION_SOURCE + '\nconst tooltipPosition = floatingPosition'
