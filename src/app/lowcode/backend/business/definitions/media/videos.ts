import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, profileInput, selectedParameter } from '../shared'
import {
  mediaColumns,
  mediaDetails,
  mediaHistoryColumns,
  mediaInputs,
  mediaNote,
  mediaPlaybackDetails,
  mediaVideoPlayer,
  mediaVideoStatuses
} from './fields'

export function mediaPublicVideosPage(): BusinessPageDefinition {
  return {
    id: 'media-videos',
    path: '/videos',
    title: t('Video library', '视频目录'),
    public: true,
    description: t(
      'Browse published videos and select one to play. Playback depends on its configured media URL. Sign in to save a favorite; unpublished videos cannot be added.',
      '浏览已发布视频，选择后播放。实际播放取决于配置的媒体地址。登录后可收藏，未发布的视频不可加入收藏。'
    ),
    listing: { resourceId: 'media-videos', columns: mediaColumns, search: true },
    details: mediaDetails,
    videoPlayer: mediaVideoPlayer,
    actions: [
      formAction({
        id: 'create-media-favorite',
        en: 'Save video',
        zh: '收藏视频',
        inputs: [],
        parameters: { videoId: selectedParameter() },
        description: t(
          'Save the selected published video to your account. If you removed this favorite before, restore its existing record from My favorites.',
          '将选中的已发布视频加入本人收藏。若以前取消过此收藏，请到“我的收藏”恢复原记录。'
        )
      })
    ]
  }
}

export function mediaVideoManagementPage(): BusinessPageDefinition {
  const selected = { videoId: selectedParameter() }
  return {
    id: 'media-management-videos',
    path: '/creator/videos',
    title: t('Creator videos', '创作者视频管理'),
    description: t(
      'media-creator manages their own videos; media-admin manages all. Publish a reviewed playback URL. Upload, transcoding and CDN services must be connected after export.',
      'media-creator管理本人视频，media-admin管理全部视频。请核对播放地址后发布；上传、转码与CDN服务需在导出后接入。'
    ),
    listing: {
      resourceId: 'media-management-videos',
      columns: [...mediaColumns, { field: 'status', label: t('Publication status', '发布状态') }],
      search: true,
      filter: { field: 'status', choices: mediaVideoStatuses }
    },
    details: [
      ...mediaDetails,
      { field: 'status', label: t('Publication status', '发布状态') },
      ...mediaPlaybackDetails
    ],
    videoPlayer: mediaVideoPlayer,
    related: [
      {
        resourceId: 'media-video-history',
        foreignKey: 'video_id',
        title: t('Video history', '视频操作记录'),
        columns: mediaHistoryColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-media-video',
        en: 'Create video draft',
        zh: '创建视频草稿',
        inputs: [profileInput('my-profile'), ...mediaInputs()],
        description: t(
          'Choose your registered profile and enter the video details. This creates metadata only; it does not upload or transcode a file.',
          '选择本人已登记资料并填写视频信息。此操作仅创建视频记录，不上传或转码文件。'
        )
      }),
      formAction({
        id: 'update-media-video',
        en: 'Edit video',
        zh: '编辑视频',
        inputs: [...mediaInputs(true), mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['draft', 'published'] },
        description: t(
          'Edit the selected draft or published video. Changes to a published record become visible in the public catalog; review its playback address before saving.',
          '编辑选中的草稿或已发布视频。已发布记录的修改会出现在公开目录中，请核对播放地址后保存。'
        )
      }),
      formAction({
        id: 'publish-media-video',
        en: 'Publish video',
        zh: '发布视频',
        inputs: [mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['draft'] },
        description: t(
          'A playback URL is required. Publishing makes the record publicly readable; it does not verify media availability or run upload and transcoding services.',
          '发布前须填写播放地址。发布会公开此记录，不会验证媒体服务可用性，也不会执行上传或转码。'
        )
      }),
      formAction({
        id: 'archive-media-video',
        en: 'Archive video',
        zh: '归档视频',
        inputs: [mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['draft', 'published'] },
        description: t(
          'Remove this video from public reading and new favorites. Existing favorite records remain private; archiving does not delete a file from the media host.',
          '停止此视频的公开读取与新增收藏，保留已有的私人收藏记录。归档不会删除媒体服务上的文件。'
        )
      }),
      formAction({
        id: 'restore-media-video',
        en: 'Restore video draft',
        zh: '恢复为视频草稿',
        inputs: [mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['archived'] },
        description: t(
          'Restore the selected archive as a draft. Review and publish it again before it can appear in the public catalog.',
          '将选中的归档记录恢复为草稿。核对后须重新发布，才会再次出现在公开目录中。'
        )
      })
    ]
  }
}
