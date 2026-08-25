import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(
    import.meta.dir,
    '../../../../../src/components/settings/storage/StorageSettingsPanel.vue'
  ),
  'utf8'
)

describe('storage settings provider wiring', () => {
  test('mounts all account providers before the S3 advanced fallback', () => {
    const google = source.indexOf('<GoogleDriveStorageConnection')
    const oneDrive = source.indexOf('<OneDriveStorageConnection')
    const aliyun = source.indexOf('<AliyunDriveStorageConnection')
    const baidu = source.indexOf('<BaiduNetdiskStorageConnection')
    const s3 = source.indexOf('<S3CompatibleStorageSettings')

    expect(google).toBeGreaterThan(-1)
    expect(oneDrive).toBeGreaterThan(google)
    expect(aliyun).toBeGreaterThan(oneDrive)
    expect(baidu).toBeGreaterThan(aliyun)
    expect(s3).toBeGreaterThan(baidu)
  })

  test('delegates profile removal to each provider lifecycle component', () => {
    expect(source).toContain('handle = aliyunDriveSettings.value')
    expect(source).toContain('handle = baiduNetdiskSettings.value')
    expect(source).toContain('ref="aliyunDriveSettings"')
    expect(source).toContain('ref="baiduNetdiskSettings"')
  })
})
