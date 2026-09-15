import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, profileInput, selectedParameter, textInput } from '../shared'
import {
  mediaChannelStatuses,
  mediaColumns,
  mediaDetails,
  mediaHistoryColumns,
  mediaInputs,
  mediaNote,
  mediaPlaybackDetails,
  mediaVideoPlayer
} from './fields'

const channelStatus = { field: 'status', label: t('Broadcast label', '直播标记') }
const scheduleColumn = { field: 'scheduled_at', label: t('Scheduled for', '计划开播时间') }

export function mediaPublicChannelsPage(): BusinessPageDefinition {
  return {
    id: 'media-channels',
    path: '/live',
    title: t('Live channels', '直播频道'),
    public: true,
    description: t(
      'Browse scheduled channels and broadcasts marked live or ended. The label is metadata, not a stream health check. A working playback URL is required to watch.',
      '浏览已排期、已标记开播或结束的频道。直播标记只是业务记录，不代表直播流可用；观看需要有效的播放地址。'
    ),
    listing: {
      resourceId: 'media-channels',
      columns: [...mediaColumns, channelStatus, scheduleColumn],
      search: true,
      filter: {
        field: 'status',
        choices: mediaChannelStatuses.filter((choice) =>
          ['scheduled', 'live', 'ended'].includes(String(choice.value))
        )
      }
    },
    details: [...mediaDetails, channelStatus, scheduleColumn],
    videoPlayer: mediaVideoPlayer,
    actions: []
  }
}

export function mediaChannelManagementPage(): BusinessPageDefinition {
  const selected = { channelId: selectedParameter() }
  return {
    id: 'media-management-channels',
    path: '/creator/channels',
    title: t('Creator channels', '创作者频道管理'),
    description: t(
      'Manage your channel details and schedule. Marking live or ended changes metadata only. Connect your encoder, streaming service and CDN after export, then verify the playback URL.',
      '管理本人的频道信息与排期。标记开播或结束只更新业务记录；编码器、推流服务与CDN需在导出后接入，并核验播放地址。'
    ),
    listing: {
      resourceId: 'media-management-channels',
      columns: [...mediaColumns, channelStatus, scheduleColumn],
      search: true,
      filter: { field: 'status', choices: mediaChannelStatuses }
    },
    details: [...mediaDetails, channelStatus, scheduleColumn, ...mediaPlaybackDetails],
    videoPlayer: mediaVideoPlayer,
    related: [
      {
        resourceId: 'media-channel-history',
        foreignKey: 'channel_id',
        title: t('Channel history', '频道操作记录'),
        columns: mediaHistoryColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-media-channel',
        en: 'Create channel draft',
        zh: '创建频道草稿',
        inputs: [profileInput('my-profile'), ...mediaInputs()],
        description: t(
          'Choose your registered profile and create a draft. This does not provision a streaming service or generate a publishing key.',
          '选择本人已登记资料并创建草稿。此操作不会开通直播服务，也不会生成推流密钥。'
        )
      }),
      formAction({
        id: 'update-media-channel',
        en: 'Edit channel',
        zh: '编辑频道',
        inputs: [...mediaInputs(true), mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['draft', 'scheduled', 'live', 'ended'] },
        description: t(
          'Edit the selected channel details and playback address. This does not change its schedule or broadcast label and does not restart an external stream.',
          '编辑选中频道的信息与播放地址，不改变排期或直播标记，也不会重启外部直播流。'
        )
      }),
      formAction({
        id: 'schedule-media-channel',
        en: 'Schedule channel',
        zh: '设置频道排期',
        inputs: [
          textInput(
            'scheduledAt',
            'Start (ISO 8601 with time zone)',
            '开播时间（ISO 8601含时区）',
            40
          ),
          mediaNote()
        ],
        parameters: selected,
        when: { field: 'status', values: ['draft'] },
        description: t(
          'Choose a future time to publish the channel preview. The server checks its clock. Scheduling does not start a stream automatically.',
          '填写未来时间并公开频道预告，服务器会核对时间。排期不会自动启动直播流。'
        )
      }),
      formAction({
        id: 'start-media-channel',
        en: 'Mark live',
        zh: '标记开播',
        inputs: [mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['scheduled'] },
        description: t(
          'A scheduled channel needs a playback URL. You may mark it live before its announced time. This only updates the record; start and verify the real stream in your streaming service.',
          '已排期频道须填写播放地址，可提前手动标记开播。此操作仅将记录标记为开播；请在接入的直播服务中启动并核验真实推流。'
        )
      }),
      formAction({
        id: 'end-media-channel',
        en: 'Mark ended',
        zh: '标记结束',
        inputs: [mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['live'] },
        description: t(
          'Only update the channel record to ended. Stop the actual stream in your streaming service; this action does not stop an encoder or create a replay.',
          '仅将频道记录标记为结束。请在直播服务中另行停止真实推流；此操作不会停止编码器，也不会生成回放。'
        )
      }),
      formAction({
        id: 'archive-media-channel',
        en: 'Archive channel',
        zh: '归档频道',
        inputs: [mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['draft', 'scheduled', 'ended'] },
        description: t(
          'Remove the channel from public reading. A channel marked live must first be marked ended; archiving does not stop its external stream.',
          '停止频道的公开读取。已标记开播的频道须先标记结束；归档不会停止外部直播流。'
        )
      }),
      formAction({
        id: 'restore-media-channel',
        en: 'Restore channel draft',
        zh: '恢复为频道草稿',
        inputs: [mediaNote()],
        parameters: selected,
        when: { field: 'status', values: ['archived'] },
        description: t(
          'Restore the archived channel as a private draft and clear its previous schedule. Review its details and set a new schedule before publishing it again.',
          '将归档频道恢复为未公开草稿，并清空原排期。核对信息后设置新的排期，再次公开频道。'
        )
      })
    ]
  }
}
