import type { CompilerOptions } from '#compiler/types'

import type { MiniProgramPagePlan } from '../miniprogram-shared'
import { safeMiniProgramName } from '../miniprogram-shared'

export function buildWechatAppJS(): string {
  return `App({})\n`
}

export function buildWechatAppJSON(
  pages: readonly MiniProgramPagePlan[],
  options: CompilerOptions
): string {
  return jsonFile({
    pages: pages.map((page) => page.route),
    window: {
      navigationBarTitleText: safeDisplayName(options.productName ?? options.packageName),
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
      backgroundColor: '#ffffff'
    },
    style: 'v2',
    sitemapLocation: 'sitemap.json'
  })
}

export function buildWechatAppWXSS(): string {
  return `page {
  min-height: 100%;
  box-sizing: border-box;
  background: #ffffff;
  color: #111827;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

view, text, image, button, input, textarea, form {
  box-sizing: border-box;
}
`
}

export function buildWechatProjectConfig(options: CompilerOptions): string {
  return jsonFile({
    description: 'OpenPencil generated native WeChat Mini Program source',
    miniprogramRoot: './',
    projectname: safeMiniProgramName(options.packageName, 'openpencil-wechat-miniprogram'),
    compileType: 'miniprogram',
    setting: {
      es6: true,
      minified: true,
      postcss: true,
      urlCheck: true,
      checkSiteMap: true
    }
  })
}

export function buildWechatSitemapJSON(): string {
  return jsonFile({
    desc: 'OpenPencil generated sitemap',
    rules: [{ action: 'allow', page: '*' }]
  })
}

export function buildWechatPageJSON(page: MiniProgramPagePlan): string {
  return jsonFile({ navigationBarTitleText: safeDisplayName(page.pageName) })
}

export function buildWechatReadme(): string {
  return `# OpenPencil WeChat Mini Program export

This is native WeChat Mini Program source generated from OpenPencil's shared compiler IR. It contains no webview wrapper, npm runtime, AppID, credential, or remote-code dependency.

## Open in WeChat DevTools

1. Import this directory as a Mini Program project.
2. Select or enter the destination project's AppID in WeChat DevTools. OpenPencil intentionally does not write one into \`project.config.json\`.
3. Review the export warnings and test every page on a simulator and physical device before release.

## v1 boundary

The exporter supports static native WXML/WXSS pages, local raster assets, basic local page state, controlled inputs, simple conditions/lists, state updates, and navigation. Unsupported web, network, credential, server-workflow, Motion, raw-HTML, dynamic-image, and advanced component behavior is omitted with structured compiler warnings.
`
}

function safeDisplayName(value: string): string {
  const normalized = value
    .split('')
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 31 || code === 127 ? ' ' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || 'OpenPencil App').slice(0, 32)
}

function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
