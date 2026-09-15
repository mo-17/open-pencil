import {
  businessText as t,
  type BusinessChoice,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { textInput } from '../shared'

export const mediaColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Title', '标题') },
  { field: 'category', label: t('Category', '分类') }
]

export const mediaDetails: readonly BusinessColumn[] = [
  ...mediaColumns,
  { field: 'description', label: t('Description', '内容介绍'), multiline: true },
  { field: 'created_at', label: t('Created at', '创建时间') }
]

export const mediaPlaybackDetails: readonly BusinessColumn[] = [
  { field: 'playback_url', label: t('Public playback URL', '公开播放地址') },
  { field: 'poster_url', label: t('Public poster URL', '公开封面地址') }
]

export const mediaHistoryColumns: readonly BusinessColumn[] = [
  { field: 'action', label: t('Action', '操作') },
  { field: 'before_status', label: t('Previous status', '原状态') },
  { field: 'after_status', label: t('New status', '新状态') },
  { field: 'note', label: t('Explanation', '操作说明'), multiline: true },
  { field: 'created_at', label: t('Recorded at', '记录时间') }
]

export const mediaVideoStatuses: readonly BusinessChoice[] = [
  { value: 'draft', label: t('Draft', '草稿') },
  { value: 'published', label: t('Published', '已发布') },
  { value: 'archived', label: t('Archived', '已归档') }
]

export const mediaChannelStatuses: readonly BusinessChoice[] = [
  { value: 'draft', label: t('Draft', '草稿') },
  { value: 'scheduled', label: t('Scheduled', '已排期') },
  { value: 'live', label: t('Marked live', '已标记开播') },
  { value: 'ended', label: t('Marked ended', '已标记结束') },
  { value: 'archived', label: t('Archived', '已归档') }
]

export const mediaVideoPlayer = { srcField: 'playback_url', posterField: 'poster_url' } as const

export const mediaNote = (): BusinessInput => textInput('note', 'Explanation', '操作说明', 500)

export function mediaInputs(edit = false): BusinessInput[] {
  const inputs: BusinessInput[] = [
    textInput('title', 'Title', '标题', 200),
    textInput('category', 'Category', '分类', 100),
    textInput('description', 'Description', '内容介绍', 2000),
    {
      key: 'playbackUrl',
      label: t('Public playback URL (optional for drafts)', '公开播放地址（草稿可留空）'),
      kind: 'text',
      maxLength: 2048,
      required: false
    },
    {
      key: 'posterUrl',
      label: t('Public poster URL (optional)', '公开封面地址（选填）'),
      kind: 'text',
      maxLength: 2048,
      required: false
    }
  ]
  if (!edit) return inputs
  const fields: Readonly<Record<string, string>> = {
    playbackUrl: 'playback_url',
    posterUrl: 'poster_url'
  }
  return inputs.map((input) => ({ ...input, fromSelection: fields[input.key] ?? input.key }))
}
