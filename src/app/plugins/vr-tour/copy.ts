const EN = {
  addScene: 'Add room',
  removeScene: 'Remove room',
  newScene: 'New room',
  title: 'Room name',
  panorama: '360° panorama image',
  addHotspot: 'Add room link',
  removeHotspot: 'Remove link',
  hotspot: 'Room link',
  label: 'Link label',
  target: 'Destination room',
  yaw: 'Horizontal angle (°)',
  pitch: 'Vertical angle (°)',
  hint: 'Use a 2:1 equirectangular image. Public HTTPS images require CORS. Local exports accept /assets/vr-tour/ paths; copy your image into public/assets/vr-tour/. Empty images show a labelled diagram.',
  privacy:
    'The editor canvas stays offline. Load the actual panorama in desktop preview or the exported page.',
  room: 'Room',
  samples: 'Use real residential samples',
  samplesLoading: 'Preparing residential samples…',
  samplesHint:
    'Two 8K panoramas are included with this plugin installation. Applying them replaces the current scenes and can be undone. Used images are saved with the document and export.',
  samplesCredit:
    'Two independent residences, not a connected floor plan. Photos: Greg Zaal / Poly Haven · CC0.',
  samplesBound:
    'This viewer uses the selected property’s panorama field. Use an unbound VR Tour module to try the sample scenes.',
  samplesFailed: 'Could not prepare the residential samples. Check your connection and retry.',
  samplesChanged: 'The selection or plugin changed. Select the VR Tour module and try again.',
  samplesUndo: 'Use residential panorama samples',
  invalidScenes:
    'Check room names, image URLs and hotspot destinations. Use a public JPG, PNG or WebP URL without query parameters, or an /assets/vr-tour/ path.',
  invalidLocale: 'Choose English or Simplified Chinese.',
  invalidSetting:
    'Check this setting. Values must stay within the displayed limits and required fields cannot be empty.'
} as const

const ZH: Record<keyof typeof EN, string> = {
  addScene: '添加房间',
  removeScene: '删除房间',
  newScene: '新房间',
  title: '房间名称',
  panorama: '360° 全景图片',
  addHotspot: '添加房间热点',
  removeHotspot: '删除热点',
  hotspot: '房间热点',
  label: '热点文字',
  target: '目标房间',
  yaw: '水平角度（°）',
  pitch: '垂直角度（°）',
  hint: '使用 2:1 等距柱状全景图。公开 HTTPS 图片需允许 CORS；导出项目也可使用 /assets/vr-tour/ 路径，请将图片放入 public/assets/vr-tour/。图片留空时显示标明用途的示意图。',
  privacy: '编辑器画布保持离线；请在桌面预览或导出页面中加载实际全景。',
  room: '房间',
  samples: '使用真实住宅示例',
  samplesLoading: '正在准备住宅示例…',
  samplesHint:
    '插件安装附带两张 8K 全景图。应用后替换当前场景，可撤销；使用的图片会随文档保存并一起导出。',
  samplesCredit: '两处独立住宅，并非真实连通户型。图片：Greg Zaal / Poly Haven · CC0。',
  samplesBound: '此组件使用选中房源的全景字段。请插入一个未绑定房源的 VR 看房组件来试用示例场景。',
  samplesFailed: '住宅示例准备失败，请检查网络后重试。',
  samplesChanged: '选中组件或插件状态已变化，请重新选择 VR 看房组件后再试。',
  samplesUndo: '使用住宅全景示例',
  invalidScenes:
    '请检查房间名称、图片地址和热点目标。图片应为不带查询参数的公开 JPG、PNG、WebP 地址，或 /assets/vr-tour/ 本地路径。',
  invalidLocale: '请选择 English 或简体中文。',
  invalidSetting: '请检查此项设置：数值需在标明的范围内，必填内容不能为空。'
}

export function vrTourEditorCopy(locale: string) {
  return locale.startsWith('zh') ? ZH : EN
}
