import { VRTourSampleAssetError } from './types'

export function vrTourSampleAssetCopy(locale: string) {
  return locale.toLowerCase().startsWith('zh')
    ? {
        install: '安装并下载 8K 示例资源（约 6.5 MB）',
        preparing: '正在校验并缓存 8K 示例资源（约 6.5 MB）…',
        failure: '8K 示例资源（约 6.5 MB）未准备好，插件未完成安装。',
        cancelled: '操作已取消，请重试。',
        timeout: '下载超时，请检查网络后重试。',
        network: '无法下载示例，请检查网络后重试。',
        response: '示例来源返回了无效响应，请稍后重试。',
        size: '示例文件大小与已审核版本不符，请稍后重试。',
        integrity: '示例完整性校验失败，请稍后重试。',
        storage: '示例无法完整保存到本机缓存，请检查可用空间后重试。'
      }
    : {
        install: 'Install with 8K samples (about 6.5 MB)',
        preparing: 'Verifying and caching 8K samples (about 6.5 MB)…',
        failure: '8K samples (about 6.5 MB) are not ready. Plugin installation did not complete.',
        cancelled: 'The operation was cancelled. Try again.',
        timeout: 'The download timed out. Check your connection and try again.',
        network: 'Samples could not be downloaded. Check your connection and try again.',
        response: 'The sample source returned an invalid response. Try again later.',
        size: 'The sample size does not match the reviewed version. Try again later.',
        integrity: 'Sample integrity verification failed. Try again later.',
        storage: 'Samples could not be saved completely. Check available storage and try again.'
      }
}

export function vrTourSampleAssetErrorMessage(error: unknown, locale: string): string {
  const copy = vrTourSampleAssetCopy(locale)
  return error instanceof VRTourSampleAssetError ? copy[error.code] : copy.storage
}
