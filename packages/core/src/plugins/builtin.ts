import { CHART_PLUGIN } from './chart'
import { HTML_PLUGIN } from './html'
import { MAP_PLUGIN } from './map'
import { PluginRegistry } from './registry'
import { RICH_TEXT_PLUGIN } from './rich-text'
import { SLIDE_MENU_PLUGIN } from './slide-menu'
import { TABLE_PLUGIN } from './table'
import { VIDEO_PLUGIN } from './video'

export const BUILTIN_PLUGIN_REGISTRY = new PluginRegistry()
  .register(MAP_PLUGIN)
  .register(CHART_PLUGIN)
  .register(RICH_TEXT_PLUGIN)
  .register(HTML_PLUGIN)
  .register(VIDEO_PLUGIN)
  .register(TABLE_PLUGIN)
  .register(SLIDE_MENU_PLUGIN)
  .freeze()
