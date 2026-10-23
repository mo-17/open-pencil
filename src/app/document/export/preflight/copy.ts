export function exportPreflightCopy(locale: string) {
  return locale.startsWith('zh')
    ? {
        title: '导出预检',
        check: '检查当前目标',
        close: '关闭',
        locate: '定位图层',
        ready: '未发现阻断问题',
        blocked: '需要先处理导出问题',
        stale: '文档已变化，请重新检查。',
        otherTarget: '显示最近一次导出的报告。当前选择或格式不同，可重新检查当前目标。',
        note: '按需检查图片、Shader 静态帧，并汇总最近一次源码导出的编译诊断。不会运行生成的项目或联网验证配置。',
        partial: '报告已截断，未完成的范围不代表通过。',
        summary: (format: string, count: number) => `${format} · 已检查 ${count} 个可见节点`,
        codes: {
          'missing-image': '引用的图片资源缺失，请重新载入来源图片。',
          'shader-missing': '没有可用的 Shader 保存帧，请先在支持的环境中生成。',
          'shader-pending': '实际导出时需要等待当前 Shader 静态帧完成。',
          'shader-static': '此自身内容 Shader 在该导出目标中使用静态帧。',
          'shader-stale': '当前可用的是保存帧，最新编辑尚未渲染完成。',
          'shader-unsupported': '此节点超出内容取样范围，将保留原始内容。',
          'scan-limit': '达到单次检查上限，报告不覆盖整个文档。'
        } as Record<string, string>
      }
    : {
        title: 'Export preflight',
        check: 'Check current target',
        close: 'Close',
        locate: 'Locate layer',
        ready: 'No blocking issues found',
        blocked: 'Resolve the export issues first',
        stale: 'The document changed. Run the check again.',
        otherTarget:
          'Showing the latest export report. The selection or format differs; check the current target to update it.',
        note: 'Checks images and Shader still frames on demand, alongside the latest source-export compiler diagnostics. It does not run the generated project or verify network configuration.',
        partial: 'This report is truncated. Unchecked content has not passed validation.',
        summary: (format: string, count: number) => `${format} · ${count} visible nodes checked`,
        codes: {} as Record<string, string>
      }
}
