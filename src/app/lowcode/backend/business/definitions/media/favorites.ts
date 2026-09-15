import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'

export function mediaFavoritesPage(): BusinessPageDefinition {
  return {
    id: 'media-favorites',
    path: '/favorites',
    title: t('My favorites', '我的收藏'),
    description: t(
      'Manage your private saved records, including removed favorites. Find the current published video in Video library to watch; favorites do not keep playback URLs or bypass publication rules.',
      '管理本人的私人收藏及已取消记录。观看请到视频目录查找当前已发布视频；收藏不保存播放地址，也不能绕过发布状态。'
    ),
    listing: {
      resourceId: 'media-favorites',
      columns: [
        { field: 'video_title', label: t('Title when saved', '收藏时标题') },
        { field: 'active', label: t('Saved', '已收藏') },
        { field: 'created_at', label: t('First saved at', '首次收藏时间') }
      ],
      search: true,
      filter: {
        field: 'active',
        choices: [
          { value: true, label: t('Saved', '已收藏') },
          { value: false, label: t('Removed', '已取消') }
        ]
      }
    },
    actions: [
      formAction({
        id: 'cancel-media-favorite',
        en: 'Remove favorite',
        zh: '取消收藏',
        inputs: [],
        parameters: { favoriteId: selectedParameter() },
        when: { field: 'active', values: [true] },
        description: t(
          'Remove this video from your active favorites. Keep the private record so you can restore it later.',
          '将此视频移出有效收藏，保留私人记录以便以后恢复。'
        )
      }),
      formAction({
        id: 'restore-media-favorite',
        en: 'Restore favorite',
        zh: '恢复收藏',
        inputs: [],
        parameters: {
          videoId: selectedParameter('video_id'),
          favoriteId: selectedParameter()
        },
        when: { field: 'active', values: [false] },
        description: t(
          'Restore this record only if its video is currently published. The server verifies the selected video and that the favorite belongs to your account.',
          '仅当前仍已发布的视频可恢复收藏。服务器会核对关联视频及此收藏是否属于本人账号。'
        )
      })
    ]
  }
}
