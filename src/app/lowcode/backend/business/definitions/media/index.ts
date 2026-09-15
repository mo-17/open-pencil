import { MEDIA_ROLES } from '@/app/lowcode/backend/business/model/media/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { mediaChannelManagementPage, mediaPublicChannelsPage } from './channels'
import { mediaFavoritesPage } from './favorites'
import { mediaPublicVideosPage, mediaVideoManagementPage } from './videos'

export function videoLiveDefinition(): BusinessTemplateDefinition {
  return {
    id: 'video-live',
    title: t('Video library and live channels', '视频网站与直播频道'),
    description: t(
      'Public video playback, private favorites and creator workflows. Streaming, upload, transcoding and CDN services are connected after export.',
      '公开视频播放、私人收藏与创作者管理流程。推流、上传、转码及CDN服务在导出后接入。'
    ),
    entryPage: 'media-videos',
    roles: MEDIA_ROLES,
    pages: [
      accountSetupPage(MEDIA_ROLES),
      mediaPublicVideosPage(),
      mediaPublicChannelsPage(),
      mediaFavoritesPage(),
      mediaVideoManagementPage(),
      mediaChannelManagementPage()
    ]
  }
}
