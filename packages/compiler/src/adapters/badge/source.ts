import { BADGE_SIZE_METRICS } from '@open-pencil/core/plugins'

export const BADGE_CONFIG_SOURCE = `export interface OpenPencilBadgeConfig {
  mode: 'count' | 'dot'
  count: number
  max: number
  showZero: boolean
  placement: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  size: 'small' | 'medium' | 'large'
  badgeColor: string
  textColor: string
  hostLabel: string
  hostBackground: string
  hostTextColor: string
  label: string
}`

export const BADGE_RUNTIME_SOURCE = `const badgeSizes=${JSON.stringify(BADGE_SIZE_METRICS)}
function badgeVisible(config:OpenPencilBadgeConfig):boolean {return config.mode==='dot'||config.showZero||config.count>0}
function badgeText(config:OpenPencilBadgeConfig):string {return config.mode==='dot'?'':config.count>config.max?config.max+'+':String(config.count)}
function badgeStyle(config:OpenPencilBadgeConfig) {
  const size=badgeSizes[config.size],height=config.mode==='dot'?size.dotSize:size.height
  const width=config.mode==='dot'?height:Math.max(height,Math.ceil(badgeText(config).length*size.fontSize*.7+12))
  return {'--badge-width':width+'px','--badge-height':height+'px','--badge-font-size':size.fontSize+'px',
    '--badge-content-padding':Math.max(8,height-12)+'px','--badge-color':config.badgeColor,'--badge-text':config.textColor,
    '--badge-host-background':config.hostBackground,'--badge-host-text':config.hostTextColor}
}
`

const HOST = '[data-openpencil-badge]'
export const BADGE_STYLE_SOURCE = `${HOST}{box-sizing:border-box;display:block;min-width:0;min-height:0;overflow:hidden}
${HOST} [data-badge-host]{box-sizing:border-box;position:absolute;inset:16px;min-width:0;min-height:0;border-radius:8px;background:var(--badge-host-background);color:var(--badge-host-text);padding:var(--badge-content-padding);display:flex;align-items:center;justify-content:center;overflow:hidden;font:14px/20px system-ui,sans-serif;text-align:center}
${HOST} [data-badge-host-text]{display:block;min-width:0;max-width:100%;max-height:100%;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden}
${HOST} [data-badge-value]{box-sizing:border-box;position:absolute;display:flex;align-items:center;justify-content:center;max-width:100%;max-height:100%;width:var(--badge-width);height:var(--badge-height);padding:0 4px;border:2px solid #FFFFFF;border-radius:999px;background:var(--badge-color);color:var(--badge-text);font:600 var(--badge-font-size)/1.2 system-ui,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none;overflow:hidden}
${HOST} [data-badge-value-text]{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
${HOST}[data-badge-placement^=top] [data-badge-value]{top:0}
${HOST}[data-badge-placement^=bottom] [data-badge-value]{bottom:0}
${HOST}[data-badge-placement$=left] [data-badge-value]{left:0}
${HOST}[data-badge-placement$=right] [data-badge-value]{right:0}
${HOST}[data-badge-mode=dot] [data-badge-value]{padding:0}
${HOST} [data-badge-count-label]{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;clip:rect(0,0,0,0);clip-path:inset(50%);overflow:hidden;white-space:nowrap}
`
