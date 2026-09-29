export const POPOVER_CONFIG_SOURCE = `export interface OpenPencilPopoverConfig {
 mode:'popover'|'confirm';triggerLabel:string;title:string;content:string;contentChildName:string;
 placement:'top'|'right'|'bottom'|'left';gap:number;panelWidth:number;disabled:boolean;
 confirmLabel:string;cancelLabel:string;panelBackground:string;textColor:string;accentColor:string;
 triggerBackground:string;triggerTextColor:string;borderRadius:number;fontSize:number
}`
export const POPOVER_VISUAL_SOURCE = `function popoverStyle(config:OpenPencilPopoverConfig){return {
 '--popover-trigger-bg':config.triggerBackground,'--popover-trigger-fg':config.triggerTextColor,
 '--popover-bg':config.panelBackground,'--popover-fg':config.textColor,'--popover-accent':config.accentColor,
 '--popover-radius':config.borderRadius+'px','--popover-font':config.fontSize+'px'
}}
function popoverConfigKey(config:OpenPencilPopoverConfig){return JSON.stringify([config.mode,config.triggerLabel,config.title,config.content,config.contentChildName,config.placement,config.gap,config.panelWidth,config.disabled,config.confirmLabel,config.cancelLabel,config.panelBackground,config.textColor,config.accentColor,config.triggerBackground,config.triggerTextColor,config.borderRadius,config.fontSize])}
function popoverCopy(root:HTMLElement){const zh=(root.closest('[lang]')?.getAttribute('lang')??document.documentElement.lang).toLowerCase().startsWith('zh');return zh?{close:'关闭浮层',confirmed:'已确认；未执行业务操作。',cancelled:'已取消。'}:{close:'Close popover',confirmed:'Confirmed; no business action was performed.',cancelled:'Cancelled.'}}`
export const POPOVER_STYLE_SOURCE = `[data-openpencil-popover]{min-width:0;overflow:visible!important}
[data-popover-trigger]{appearance:none;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:24px;border:0;border-radius:var(--popover-radius);padding:0 12px;background:var(--popover-trigger-bg);color:var(--popover-trigger-fg);font:400 var(--popover-font)/1.5 sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-popover-trigger]:disabled{cursor:not-allowed;opacity:.5}
[data-popover-trigger]:focus-visible,[data-popover-panel] button:focus-visible{outline:3px solid var(--popover-accent);outline-offset:2px}
[data-popover-panel]{box-sizing:border-box;inset:auto;margin:0;padding:16px;border:1px solid #94a3b844;background:var(--popover-bg);color:var(--popover-fg);border-radius:var(--popover-radius);font:400 var(--popover-font)/1.5 sans-serif;box-shadow:0 8px 28px #0003;overflow:auto;overflow-wrap:anywhere;z-index:1000}
[data-popover-panel][hidden]{display:none!important}
[data-popover-heading]{display:flex;align-items:start;gap:8px;margin-bottom:8px}
[data-popover-title]{flex:1;min-width:0;font-size:1.1em;font-weight:600;margin:0;white-space:pre-wrap}
[data-popover-close]{appearance:none;flex:none;background:transparent;border:0;border-radius:4px;color:inherit;cursor:pointer;font:inherit;min-width:28px;min-height:28px;margin:-6px -6px 0 0;padding:2px 6px}
[data-popover-content]{min-width:0;white-space:pre-wrap}
[data-popover-actions]{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:16px}
[data-popover-action]{appearance:none;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;min-height:36px;min-width:64px;padding:6px 12px}
[data-popover-action=confirm]{background:var(--popover-accent);border-color:var(--popover-accent);color:#fff}
[data-popover-status]{display:block;margin-top:6px;color:var(--popover-trigger-fg);font:400 12px/1.5 sans-serif;white-space:normal;overflow-wrap:anywhere}
[data-popover-status]:empty{display:none}
@media(forced-colors:active){[data-popover-trigger],[data-popover-panel]{border:1px solid CanvasText}}
`
