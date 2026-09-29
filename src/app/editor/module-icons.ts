import type { Component } from 'vue'
import IconBadge from '~icons/lucide/bell-dot'
import IconDateRange from '~icons/lucide/calendar-range'
import IconChart from '~icons/lucide/chart-column'
import IconBreadcrumb from '~icons/lucide/chevrons-right'
import IconProgress from '~icons/lucide/circle-gauge'
import IconAvatar from '~icons/lucide/circle-user-round'
import IconMotion from '~icons/lucide/clapperboard'
import IconCode from '~icons/lucide/code-2'
import IconPagination from '~icons/lucide/ellipsis'
import IconAudio from '~icons/lucide/file-audio'
import IconFileText from '~icons/lucide/file-text'
import IconGallery from '~icons/lucide/gallery-horizontal-end'
import IconTimeline from '~icons/lucide/git-commit-vertical'
import IconAlert from '~icons/lucide/info'
import IconDescriptions from '~icons/lucide/list'
import IconListCollapse from '~icons/lucide/list-collapse'
import IconStepper from '~icons/lucide/list-ordered'
import IconTree from '~icons/lucide/list-tree'
import IconMap from '~icons/lucide/map'
import IconMenu from '~icons/lucide/menu'
import IconTooltip from '~icons/lucide/message-circle-question-mark'
import IconPopover from '~icons/lucide/message-square'
import IconOrgChart from '~icons/lucide/network'
import IconEmptyState from '~icons/lucide/package-open'
import IconPanelLeftOpen from '~icons/lucide/panel-left-open'
import IconTabs from '~icons/lucide/panel-top'
import IconModal from '~icons/lucide/panels-top-left'
import IconPuzzle from '~icons/lucide/puzzle'
import IconQrCode from '~icons/lucide/qr-code'
import IconSkeleton from '~icons/lucide/rectangle-ellipsis'
import IconWalktour from '~icons/lucide/route'
import IconSlider from '~icons/lucide/sliders-horizontal'
import IconRating from '~icons/lucide/star'
import IconTable from '~icons/lucide/table'
import IconGrid from '~icons/lucide/table-properties'
import IconChip from '~icons/lucide/tag'
import IconType from '~icons/lucide/type'
import IconUpload from '~icons/lucide/upload'
import IconVideo from '~icons/lucide/video'
import IconView from '~icons/lucide/view'

const MODULE_ICONS = new Map<string, Component>([
  ['date-range', IconDateRange],
  ['descriptions', IconDescriptions],
  ['pagination', IconPagination],
  ['org-chart', IconOrgChart],
  ['walktour', IconWalktour],
  ['tree', IconTree],
  ['cascader', IconTree],
  ['popover', IconPopover],
  ['alert', IconAlert],
  ['progress', IconProgress],
  ['chip', IconChip],
  ['tooltip', IconTooltip],
  ['skeleton', IconSkeleton],
  ['empty-state', IconEmptyState],
  ['avatar', IconAvatar],
  ['badge', IconBadge],
  ['timeline', IconTimeline],

  ['slider', IconSlider],
  ['rating', IconRating],
  ['stepper', IconStepper],
  ['breadcrumb', IconBreadcrumb],
  ['map', IconMap],
  ['chart', IconChart],
  ['rich-text', IconType],
  ['html', IconCode],
  ['code-block', IconCode],
  ['table', IconTable],
  ['data-grid', IconGrid],
  ['slide-menu', IconPanelLeftOpen],
  ['dropdown-menu', IconMenu],
  ['tabs', IconTabs],
  ['accordion', IconListCollapse],
  ['qr-barcode', IconQrCode],
  ['markdown', IconFileText],
  ['pdf-viewer', IconFileText],
  ['audio-player', IconAudio],
  ['upload-button', IconUpload],
  ['video', IconVideo],
  ['vr-tour', IconView],
  ['modal', IconModal],
  ['lottie', IconMotion],
  ['carousel', IconGallery]
])

// Presentation only: an icon neither installs a plugin nor grants execution authority.
export function moduleIcon(pluginId: string, moduleType: string): Component {
  if (pluginId !== `open-pencil.${moduleType}`) return IconPuzzle
  return MODULE_ICONS.get(moduleType) ?? IconPuzzle
}
