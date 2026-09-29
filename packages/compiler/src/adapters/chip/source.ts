import { CHIP_CHECK_PATH, CHIP_DELETE_PATH, CHIP_LAYOUT } from '@open-pencil/core/plugins'

export const CHIP_CONFIG_SOURCE = `export interface OpenPencilChipConfig {
  label:string; variant:'soft'|'outlined'|'filled'; color:string; filledTextColor:string;
  borderRadius:number; fontSize:number; selectable:boolean; initialSelected:boolean;
  deletable:boolean; deleteLabel:string; removedLabel:string; disabled:boolean
}
function chipConfigKey(config: OpenPencilChipConfig): string {
  return JSON.stringify([config.label,config.variant,config.color,config.filledTextColor,
    config.borderRadius,config.fontSize,config.selectable,config.initialSelected,
    config.deletable,config.deleteLabel,config.removedLabel,config.disabled])
}
const checkPath = ${JSON.stringify(CHIP_CHECK_PATH)}
const deletePath = ${JSON.stringify(CHIP_DELETE_PATH)}
`
const HOST = '[data-openpencil-chip]'
export const CHIP_STYLE_SOURCE = `${HOST}{box-sizing:border-box;min-width:0;min-height:${CHIP_LAYOUT.actionSize}px;font:600 var(--chip-font)/${CHIP_LAYOUT.lineHeight} system-ui,sans-serif;outline:none}
${HOST} [data-chip-body]{display:flex;align-items:stretch;box-sizing:border-box;width:100%;height:100%;min-height:${CHIP_LAYOUT.actionSize}px;min-width:0;border:0;border-radius:var(--chip-radius);background:var(--chip-color-soft);color:var(--chip-color)}
${HOST}[data-variant=outlined] [data-chip-body]{background:transparent;box-shadow:inset 0 0 0 1px var(--chip-color)}
${HOST}[data-variant=filled] [data-chip-body],${HOST}[data-selected=true] [data-chip-body]{background:var(--chip-color);color:var(--chip-filled-text)}
${HOST}[data-disabled=true] [data-chip-body]{opacity:.45}
${HOST} [data-chip-label]{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${HOST} [data-chip-main]{display:flex;align-items:center;gap:8px;box-sizing:border-box;flex:1;min-width:0;min-height:${CHIP_LAYOUT.actionSize}px;padding:0 ${CHIP_LAYOUT.inset}px;border:0;border-radius:inherit;background:transparent;color:inherit;font:inherit;text-align:start}
${HOST} [data-chip-main]:has(+[data-chip-delete]){padding-right:0}
${HOST} button{cursor:pointer;touch-action:manipulation}
${HOST} button:disabled{cursor:not-allowed}
${HOST} button:focus-visible{outline:2px solid currentColor;outline-offset:-4px}
${HOST} button:not(:disabled):hover{background:#0000000F}
${HOST} svg{display:block;flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
${HOST} [data-chip-delete]{display:flex;align-items:center;justify-content:center;flex:none;width:${CHIP_LAYOUT.actionSize}px;min-height:${CHIP_LAYOUT.actionSize}px;border:0;border-radius:inherit;background:transparent;color:inherit;padding:0}
${HOST} [data-chip-announcement]{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`
