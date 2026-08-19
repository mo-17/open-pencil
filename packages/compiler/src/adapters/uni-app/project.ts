import type { CompilerOptions } from '#compiler/types'

import type { MiniProgramPagePlan } from '../miniprogram-shared'

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function buildUniAppMain(): string {
  return `import App from './App.vue'
import { createSSRApp } from 'vue'

export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
`
}

export function buildUniAppRoot(): string {
  return `<script>
export default {}
</script>

<style>
@import './uni.scss';
</style>
`
}

export function buildUniAppPages(
  pages: readonly MiniProgramPagePlan[],
  options: CompilerOptions
): string {
  const productName = options.productName || options.packageName || 'OpenPencil uni-app'
  return json({
    pages: pages.map((page) => ({
      path: page.route,
      style: { navigationBarTitleText: page.pageName || productName }
    })),
    globalStyle: {
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
      navigationBarTitleText: productName,
      backgroundColor: '#ffffff'
    }
  })
}

export function buildUniAppManifest(options: CompilerOptions): string {
  const productName = options.productName || options.packageName || 'OpenPencil uni-app'
  return json({
    name: productName,
    description: 'OpenPencil generated uni-app source project',
    versionName: '1.0.0',
    versionCode: '100',
    transformPx: false,
    'mp-weixin': {
      setting: {
        es6: true,
        minified: true,
        postcss: true,
        urlCheck: true
      },
      usingComponents: true
    }
  })
}

export function buildUniAppGlobalStyle(): string {
  return `page {
  box-sizing: border-box;
  min-height: 100%;
  background: #ffffff;
  color: #111827;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

view, text, image, button, input, textarea, form {
  box-sizing: border-box;
}
`
}

export function buildUniAppGitignore(): string {
  return `unpackage/
project.private.config.json
.DS_Store
`
}

export function buildUniAppReadme(): string {
  return `# OpenPencil uni-app export

This is a source-only uni-app Vue 3 project for WeChat Mini Program output.

1. Import this directory into HBuilderX as an existing uni-app project.
2. Configure the WeChat AppID in HBuilderX or a local private project configuration.
3. Run the project with the WeChat Mini Program target.

OpenPencil intentionally does not export an AppID, AppSecret, credential, remote endpoint, or local filesystem path. Unsupported runtime features are returned as compiler diagnostics and are not replaced with hidden network behavior.
`
}
