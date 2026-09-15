import { vrTourHybridKey } from '#compiler/adapters/vr-tour/hybrid'
import type { IRElement } from '#compiler/ir/types'

import { resolveVRTourModule } from '@open-pencil/core/plugins'

import type { MiniProgramWarningSink } from '../miniprogram-shared'

export const TARO_VR_TOUR_PAGE = 'vr-tour/page/index'

interface TaroVRTourContext {
  vrTourIds: ReadonlySet<string>
  vrTourModules: Set<string>
  usesVRTour: boolean
  styleSheet: { register(node: IRElement): string | undefined }
  warn: MiniProgramWarningSink
}

export function emitTaroVRTourElement(
  node: IRElement,
  ctx: TaroVRTourContext,
  level: number
): string | null {
  const config = resolveTaroVRTour(node)
  if (!config) return null
  const bound = node.module?.panoramaUrlExpr !== undefined
  if (!bound && !ctx.vrTourIds.has(node.sourceId)) return null
  ctx.usesVRTour = true
  ctx.vrTourModules.add(node.sourceId)
  ctx.warn({
    code: bound ? 'taro-vr-tour-binding-unsupported' : 'taro-vr-tour-https-hosting-required',
    message: bound
      ? 'Taro disabled a dynamic listing panorama binding and did not substitute the authored static panorama'
      : 'Taro VR tours require separately hosted HTTPS HTML, a configured WeChat business domain and an eligible account',
    nodeId: node.sourceId
  })
  const className = ctx.styleSheet.register(node)
  const attrs = className ? ` className=${JSON.stringify(className)}` : ''
  const pad = '  '.repeat(level)
  const element = `${pad}<OpenPencilVRTour tourId=${JSON.stringify(vrTourHybridKey(node.sourceId))} locale=${JSON.stringify(config.locale)} bound={${bound}} label=${JSON.stringify(config.label)}${attrs} />`
  return node.overlay ? `${pad}{${node.overlay.openRef} && (\n${element}\n${pad})}` : element
}

export function resolveTaroVRTour(node: IRElement) {
  const module = node.module
  if (!module) return null
  const result = resolveVRTourModule({
    version: 1,
    pluginId: module.pluginId,
    moduleType: module.moduleType,
    configVersion: module.configVersion,
    config: module.payload
  })
  return result?.ok ? result.config : null
}

export function buildTaroVRTourRoute(tourIds: ReadonlySet<string>): string {
  const keys = [...tourIds].map(vrTourHybridKey).sort()
  return String.raw`// Only compiler-generated tour keys may select a hosted document.
const tourIds = new Set<string>(${JSON.stringify(keys)})
export const VR_TOUR_PAGE = ${JSON.stringify(TARO_VR_TOUR_PAGE)}
export type VRTourRoute = { status: 'ready'; url: string } | { status: 'setup' | 'invalid-config' | 'invalid-tour' }

export function resolveVRTourRoute(baseURL: string, tourId: unknown): VRTourRoute {
  if (typeof tourId !== 'string' || !tourIds.has(tourId)) return { status: 'invalid-tour' }
  if (baseURL === '') return { status: 'setup' }
  if (typeof baseURL !== 'string' || baseURL.length > 1800) return { status: 'invalid-config' }
  // Mini-program JavaScript does not require a browser URL implementation.
  // Reject credentials, queries, fragments, percent escapes, ports and noncanonical paths.
  const match = /^https:\/\/([a-z0-9.-]+)((?:\/[A-Za-z0-9._~-]+)*\/?)$/.exec(baseURL)
  if (!match) return { status: 'invalid-config' }
  const host = match[1]
  const labels = host.split('.')
  if (host.length > 253 || labels.length < 2 || !/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return { status: 'invalid-config' }
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return { status: 'invalid-config' }
  if (match[2].split('/').some((segment) => segment === '.' || segment === '..')) return { status: 'invalid-config' }
  const directory = baseURL.endsWith('/') ? baseURL : baseURL + '/'
  return { status: 'ready', url: directory + tourId + '.html' }
}
`
}

const COPY_SOURCE = `export const VR_TOUR_COPY = {
  en: {
    open: 'Open panorama',
    setup: 'Build vr-tour-web, host its dist folder on HTTPS, then set VR_TOUR_BASE_URL in src/vr-tour/config.ts and configure the WeChat business domain.',
    invalid: 'Check VR_TOUR_BASE_URL: use a lowercase HTTPS domain and directory, without credentials, query, fragment, port or escaped path.',
    unknown: 'This panorama is not included in the exported project.',
    platform: 'This panorama page requires the WeChat Mini Program runtime. Use the exported React/Vue project on the web.',
    bound: 'Live listing panorama bindings are not supported in this Taro export. A static panorama will not replace the selected listing.',
    failed: 'The panorama page could not be opened. Check HTTPS hosting, the WeChat business domain and account eligibility.',
    retry: 'Retry'
  },
  'zh-CN': {
    open: '打开全景',
    setup: '请构建 vr-tour-web，将 dist 目录部署到 HTTPS，填写 src/vr-tour/config.ts 中的 VR_TOUR_BASE_URL，并配置微信业务域名。',
    invalid: '请检查 VR_TOUR_BASE_URL：使用小写 HTTPS 域名和目录，不含凭据、查询参数、片段、端口或转义路径。',
    unknown: '导出项目中没有这个全景。',
    platform: '此全景页面需要微信小程序运行环境。网页端请使用导出的 React/Vue 项目。',
    bound: '此 Taro 导出暂不支持当前房源的动态全景绑定，不会使用静态全景替代所选房源。',
    failed: '无法打开全景页面。请检查 HTTPS 部署、微信业务域名和小程序账号资格。',
    retry: '重试'
  }
} as const
`

export function emitTaroVRTourSupport(tourIds: ReadonlySet<string>): Map<string, string> {
  const files = new Map<string, string>()
  files.set(
    'src/vr-tour/config.ts',
    `// Public HTTPS directory containing vr-tour-web/dist/<tour-key>.html.
// Configure the WeChat business domain separately. Never put tokens or credentials here.
export const VR_TOUR_BASE_URL: string = ''
`
  )
  files.set('src/vr-tour/route.ts', buildTaroVRTourRoute(tourIds))
  files.set('src/vr-tour/copy.ts', COPY_SOURCE)
  files.set('src/vr-tour/launch.tsx', buildTaroVRTourLaunch())
  if (tourIds.size > 0) {
    files.set('src/vr-tour/page/index.tsx', buildTaroVRTourPage())
    files.set(
      'src/vr-tour/page/index.config.ts',
      `export default definePageConfig({ navigationBarTitleText: 'VR / 全景' })\n`
    )
  }
  return files
}

function buildTaroVRTourLaunch(): string {
  return `import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { VR_TOUR_BASE_URL } from './config'
import { VR_TOUR_COPY } from './copy'
import { resolveVRTourRoute, VR_TOUR_PAGE } from './route'

interface Props { tourId: string; locale: 'en' | 'zh-CN'; bound: boolean; label: string; className?: string }
export default function OpenPencilVRTour({ tourId, locale, bound, label, className }: Props) {
  const [failed, setFailed] = useState(false)
  const copy = VR_TOUR_COPY[locale]
  const route = resolveVRTourRoute(VR_TOUR_BASE_URL, tourId)
  const unsupported = Taro.getEnv() !== Taro.ENV_TYPE.WEAPP
  const message = bound ? copy.bound : unsupported ? copy.platform : route.status === 'setup' ? copy.setup : route.status === 'invalid-config' ? copy.invalid : route.status === 'invalid-tour' ? copy.unknown : failed ? copy.failed : ''
  function open() {
    if (bound || unsupported || route.status !== 'ready') return
    setFailed(false)
    void Taro.navigateTo({ url: '/' + VR_TOUR_PAGE + '?tour=' + encodeURIComponent(tourId) + '&locale=' + encodeURIComponent(locale) }).catch(() => setFailed(true))
  }
  return <View className={className}>
    <Text>{label}</Text>
    <Button disabled={bound || unsupported || route.status !== 'ready'} onClick={open}>{copy.open}</Button>
    {message && <Text>{message}</Text>}
  </View>
}
`
}

function buildTaroVRTourPage(): string {
  return `import { useState } from 'react'
import Taro, { useDidHide, useDidShow, useRouter } from '@tarojs/taro'
import { Button, Text, View, WebView } from '@tarojs/components'
import { VR_TOUR_BASE_URL } from '../config'
import { VR_TOUR_COPY } from '../copy'
import { resolveVRTourRoute } from '../route'

export default function VRTourPage() {
  const { params } = useRouter()
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(true)
  useDidHide(() => setVisible(false))
  useDidShow(() => setVisible(true))
  const copy = VR_TOUR_COPY[params.locale === 'zh-CN' ? 'zh-CN' : 'en']
  const route = resolveVRTourRoute(VR_TOUR_BASE_URL, params.tour)
  if (!visible) return <View />
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return <View><Text>{copy.platform}</Text></View>
  if (route.status !== 'ready') {
    const message = route.status === 'setup' ? copy.setup : route.status === 'invalid-config' ? copy.invalid : copy.unknown
    return <View><Text>{message}</Text></View>
  }
  if (failed) return <View><Text>{copy.failed}</Text><Button onClick={() => setFailed(false)}>{copy.retry}</Button></View>
  // This dedicated page contains a single full-page native WebView.
  // No token bridge, arbitrary URL parameter or native request proxy is exposed.
  return <WebView src={route.url} onError={() => setFailed(true)} />
}
`
}

export const TARO_VR_TOUR_README = `
## VR panorama web page

Static VR modules open a dedicated, full-page WeChat WebView. This is an HTTPS web-page integration, not native Canvas/XR rendering. Dynamic listing panorama bindings remain disabled and never fall back to another property's static image.

1. Run \`npm install --prefix vr-tour-web\` to install the sidecar's exact pinned dependencies.
2. Run \`npm run build:vr-tour-web\` (or \`node vr-tour-web/build.mjs\`). This builds \`vr-tour-web/dist/<tour-key>.html\`; it does not deploy anything.
3. Host the resulting \`vr-tour-web/dist/\` directory on your HTTPS site.
4. Set the public HTTPS directory URL in \`src/vr-tour/config.ts\`. Leave it empty until hosting is ready. Never place tokens or credentials in this value.
5. Configure that business domain in the WeChat Mini Program console, then rebuild the mini-program. Check its account eligibility: personal-type mini-programs cannot use WebView. Consult the official WeChat web-view component documentation.

Each WebView page is full-screen and separate from the authored layout. The generated page accepts only compiled tour keys; it does not accept an arbitrary webpage URL. No authentication/session or backend binding bridge is provided. Opening or sharing the HTML does not grant access to a native account.

The 8K source media stays in \`vr-tour-web/\` and is not copied into the mini-program \`src/\` bundle. Preserve the sidecar's source/license metadata. Test Android and iOS WeChat loading, rotation, zoom, room links, returning to the mini-program, failure/retry and memory use on real devices; source generation alone is not a device or deployment check.
`
