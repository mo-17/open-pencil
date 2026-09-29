/** Shared source keeps both generated targets' data and visuals identical. */
export const PROGRESS_CONFIG_SOURCE = `export interface OpenPencilProgressConfig {
  variant: 'linear' | 'circular'
  value: number
  indeterminate: boolean
  label: string
  pendingLabel: string
  showLabel: boolean
  showValue: boolean
  accentColor: string
  trackColor: string
  textColor: string
  backgroundColor: string
  fontSize: number
  thickness: number
  diameter: number
}`

export const PROGRESS_PRESENTATION_SOURCE = `function progressPresentation(config: OpenPencilProgressConfig) {
  const valueText = config.indeterminate ? config.pendingLabel : config.showValue ? config.value + '%' : ''
  const stroke = config.thickness / config.diameter * 100
  return {
    valueText, stroke, radius: 50 - stroke / 2,
    dash: (config.indeterminate ? 25 : config.value) + ' 100',
    styles: {color:config.textColor,background:config.backgroundColor,
      '--progress-accent':config.accentColor,'--progress-track':config.trackColor,
      '--progress-font':config.fontSize+'px','--progress-thickness':config.thickness+'px',
      '--progress-diameter':config.diameter+'px'}
  }
}`

export const PROGRESS_STYLE_SOURCE = `
[data-openpencil-progress]{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;max-width:100%;padding:16px;overflow:hidden;font-size:var(--progress-font);line-height:1.5}
[data-openpencil-progress] [data-progress-header]{display:flex;flex-shrink:0;align-items:baseline;gap:8px;min-width:0;margin-bottom:12px}
[data-openpencil-progress] [data-progress-label]{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-openpencil-progress] [data-progress-value]{width:45%;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-openpencil-progress] [data-progress-value]:first-child{width:100%}
[data-openpencil-progress] [data-progress-body]{display:flex;justify-content:center;align-items:flex-start;flex:1;min-width:0;min-height:0;overflow:hidden}
[data-openpencil-progress] [data-progress-track]{height:min(var(--progress-thickness),100%);width:100%;position:relative;overflow:hidden;background:var(--progress-track);border-radius:999px}
[data-openpencil-progress] [data-progress-fill]{display:block;height:100%;background:var(--progress-accent);border-radius:inherit}
[data-openpencil-progress][data-indeterminate="true"] [data-progress-fill]{position:relative;left:15%;width:35%;animation:op-progress-slide 1.5s ease-in-out infinite}
[data-openpencil-progress] [data-progress-ring]{display:block;width:min(100%,var(--progress-diameter));height:100%;max-height:var(--progress-diameter);overflow:visible}
[data-openpencil-progress] [data-progress-rotation]{transform-box:view-box;transform-origin:50% 50%;transform:rotate(-90deg)}
[data-openpencil-progress][data-indeterminate="true"] [data-progress-rotation]{animation:op-progress-spin 1.5s linear infinite}
@keyframes op-progress-slide{from{transform:translateX(-145%)}to{transform:translateX(290%)}}
@keyframes op-progress-spin{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}
@media(prefers-reduced-motion:reduce){[data-openpencil-progress] [data-progress-fill],[data-openpencil-progress] [data-progress-rotation]{animation:none!important}}
`
