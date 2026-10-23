export function shaderPresetCopy(locale: string) {
  return locale.startsWith('zh')
    ? {
        title: '个人滤镜预设',
        name: '预设名称',
        save: '保存当前滤镜',
        apply: '应用到选择',
        remove: '移除预设',
        select: '选择已保存预设',
        empty: '尚无个人预设',
        invalid: '请输入 1–48 个字符的名称，并选择受支持的滤镜参数。',
        full: '最多保存 24 个预设，请先移除不需要的预设。',
        storage: '浏览器未能保存预设；本次更改不会在重启后保留。',
        saved: '预设已保存',
        scope: '只保存滤镜参数；不包含图片或文档内容。同名保存会更新原预设。',
        batch: (count: number) =>
          `显示首个滤镜的参数和状态；更改会应用到全部 ${count} 个兼容图层。`,
        unsupported: '所有所选图层都需要已有的自身内容滤镜，并符合静态内容取样范围。'
      }
    : {
        title: 'Personal filter presets',
        name: 'Preset name',
        save: 'Save current filter',
        apply: 'Apply to selection',
        remove: 'Remove preset',
        select: 'Choose saved preset',
        empty: 'No personal presets yet',
        invalid: 'Use a name of 1–48 characters and supported filter parameters.',
        full: 'The library holds up to 24 presets. Remove one first.',
        storage: 'Preset storage failed. This change will not survive a restart.',
        saved: 'Preset saved',
        scope:
          'Stores filter parameters only, without images or document content. Saving the same name updates that preset.',
        batch: (count: number) =>
          `Shows the first filter's parameters and status. Edits apply to all ${count} compatible layers.`,
        unsupported:
          'Every selected layer must already have an own-content filter and support static content sampling.'
      }
}
