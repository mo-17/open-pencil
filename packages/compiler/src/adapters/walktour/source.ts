export const WALKTOUR_CONFIG_SOURCE = `interface WalktourStep{id:string;title:string;content:string;targetChildName:string;placement:'top'|'right'|'bottom'|'left'}
export interface OpenPencilWalktourConfig{triggerLabel:string;steps:readonly WalktourStep[];disabled:boolean;showProgress:boolean;showSkip:boolean;panelWidth:number;overlayOpacity:number;triggerBackground:string;triggerTextColor:string;panelBackground:string;textColor:string;accentColor:string;borderColor:string;fontSize:number;borderRadius:number}
function walktourKey(config:OpenPencilWalktourConfig):string{return JSON.stringify(config)}
function walktourCopy(root:HTMLElement){return /^zh(?:-|$)/i.test(root.closest('[lang]')?.getAttribute('lang')??'')?{close:'关闭引导',previous:'上一步',next:'下一步',finish:'完成',skip:'跳过引导',restart:'重新开始',step:'步骤',of:'/',unavailable:'此步骤的目标内容当前不可见或不可用，仍可继续阅读。',unsupported:'当前浏览器无法显示引导，请使用更新的浏览器重试。',finished:'引导已完成。可以再次启动。',skipped:'引导已跳过。可以再次启动。'}:{close:'Close guide',previous:'Previous',next:'Next',finish:'Finish',skip:'Skip guide',restart:'Restart',step:'Step',of:'of',unavailable:'The target for this step is currently hidden or unavailable. You can still continue reading.',unsupported:'This browser cannot display the guide. Try again with an updated browser.',finished:'Guide completed. You can start again.',skipped:'Guide skipped. You can start again.'}}
function walktourStyle(config:OpenPencilWalktourConfig){return {'--walktour-trigger':config.triggerBackground,'--walktour-trigger-text':config.triggerTextColor,'--walktour-panel':config.panelBackground,'--walktour-text':config.textColor,'--walktour-accent':config.accentColor,'--walktour-border':config.borderColor,'--walktour-radius':config.borderRadius+'px','--walktour-font':config.fontSize+'px'}}
`
export const WALKTOUR_STYLE_SOURCE = `[data-openpencil-walktour]{box-sizing:border-box;min-width:0;font:var(--walktour-font)/1.5 Inter,system-ui,sans-serif}
[data-openpencil-walktour] [data-walktour-trigger]{box-sizing:border-box;display:flex;align-items:center;justify-content:center;position:relative;z-index:1;width:100%;height:44px;min-height:44px;appearance:none;margin:0;padding:0 12px;border:0;border-radius:var(--walktour-radius);background:var(--walktour-trigger);color:var(--walktour-trigger-text);font:inherit;font-weight:600;cursor:pointer;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}
[data-openpencil-walktour] [data-walktour-trigger-label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-openpencil-walktour] [data-walktour-trigger]:disabled{opacity:.5;cursor:default}
[data-openpencil-walktour] [data-walktour-slot]{display:contents}
[data-openpencil-walktour] [data-walktour-dialog]{position:fixed;inset:0;box-sizing:border-box;margin:0;padding:0;border:0;width:100vw;height:100dvh;max-width:none;max-height:none;background:transparent;color:var(--walktour-text);overflow:hidden;font:var(--walktour-font)/1.5 Inter,system-ui,sans-serif}
[data-openpencil-walktour] [data-walktour-dialog]:not([open]){display:none}
[data-openpencil-walktour] [data-walktour-dialog]::backdrop{background:transparent}
[data-openpencil-walktour] [data-walktour-mask]{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}
[data-openpencil-walktour] [data-walktour-highlight]{position:fixed;box-sizing:border-box;border:2px solid var(--walktour-accent);border-radius:4px;pointer-events:none}
[data-openpencil-walktour] [data-walktour-panel]{position:fixed;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;background:var(--walktour-panel);color:var(--walktour-text);border:1px solid var(--walktour-border);border-radius:var(--walktour-radius);box-shadow:0 12px 40px #0003;outline:none}
[data-openpencil-walktour] [data-walktour-heading]{display:flex;align-items:flex-start;gap:8px;position:sticky;top:0;background:var(--walktour-panel);z-index:1}
[data-openpencil-walktour] [data-walktour-title]{margin:0;flex:1;min-width:0;overflow-wrap:anywhere;font-size:1.15em;font-weight:600;line-height:1.5}
[data-openpencil-walktour] [data-walktour-close]{flex:none;width:36px;min-height:36px;padding:0;font-size:22px}
[data-openpencil-walktour] [data-walktour-content]{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 12px}
[data-openpencil-walktour] [data-walktour-reason]{margin:8px 0;padding:8px;border:1px solid var(--walktour-border);border-radius:6px;font-size:.9em;overflow-wrap:anywhere}
[data-openpencil-walktour] [data-walktour-progress]{margin:8px 0;font-size:.85em;opacity:.75}
[data-openpencil-walktour] [data-walktour-actions]{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}
[data-openpencil-walktour] [data-walktour-dialog] button{box-sizing:border-box;appearance:none;min-height:36px;max-width:100%;padding:7px 10px;border:1px solid var(--walktour-border);border-radius:6px;background:var(--walktour-panel);color:inherit;font:inherit;cursor:pointer;overflow-wrap:anywhere}
[data-openpencil-walktour] [data-walktour-dialog] button[data-walktour-action=next]{background:var(--walktour-accent);border-color:var(--walktour-accent);color:white}
[data-openpencil-walktour] [data-walktour-dialog] button:disabled{opacity:.45;cursor:default}
[data-openpencil-walktour] button:focus-visible{outline:2px solid var(--walktour-accent);outline-offset:-3px}
[data-openpencil-walktour] [data-walktour-status]{position:absolute;left:0;top:44px;max-width:100%;font-size:.9em;color:var(--walktour-text);background:var(--walktour-panel);overflow-wrap:anywhere}
[data-openpencil-walktour] [hidden]{display:none!important}
`
